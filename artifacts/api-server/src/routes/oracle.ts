import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { DeleteLiveMatchBody, PredictMatchBody, RecordLiveMatchBody } from "@workspace/api-zod";
import {
  DEFAULT_MODEL_CONFIG,
  computeEloRatings,
  getWCTeamRatings,
  type HistoricalDatasetMetadata,
  type LoadHistoricalDatasetOptions,
  type ModelConfig,
  type TeamMetrics,
} from "../lib/elo.js";
import { logger } from "../lib/logger.js";
import {
  NUM_SIMULATIONS,
  createSeededRng,
  runSimulations,
  matchProbabilities,
  getSimulationUncertaintyMetadata,
  toPublishedSimulationResults,
  type SimResult,
  type PlayedMatch,
} from "../lib/simulation.js";
import {
  fetchEspnTournamentFeed,
  type FetchLiveTournamentFeedOptions,
  type LiveDataProviderMetadata,
} from "../lib/live-results.js";
import { WC2026_TEAMS } from "../lib/worldcup2026.js";
import { sendApiError, sendApiSuccess, type ApiErrorIssue } from "../lib/api-response.js";
import { rateLimiter } from "../middlewares/rate-limiter.js";

const router = Router();
const mutableRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: "Too many scenario mutation requests. Please wait before trying again.",
});
const MAX_REASONABLE_SCORE = 30;
const MAX_SEED_LENGTH = 128;
const RECALCULATION_BATCH_SIZE = 500;
const DEFAULT_LIVE_DATA_REFRESH_INTERVAL_MS = 30_000;
const TEAM_NAMES = new Set(WC2026_TEAMS.map((team) => team.name));

type ValidationIssuePath = Array<string | number>;
type ValidationIssueContext = {
  addIssue(issue: { code: "custom"; message: string; path?: ValidationIssuePath }): void;
};
type ZodLikeIssue = {
  path: ValidationIssuePath;
  message: string;
};
type SafeParseSchema<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ZodLikeIssue[] } };
};
type MatchTeams = {
  homeTeam: string;
  awayTeam: string;
};
type MatchPredictionInput = MatchTeams & {
  neutral?: boolean;
  isHomeA?: boolean;
  isHomeB?: boolean;
};
type LiveMatchInput = MatchTeams & {
  homeScore: number;
  awayScore: number;
};
type BodyParseResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ApiErrorIssue[] };
type OracleState = "loading" | "ready" | "error";
type OracleLoadError = {
  code: "HISTORICAL_DATA_LOAD_FAILED";
  message: string;
};
type OracleReadiness = {
  state: OracleState;
  ready: boolean;
  message: string;
  error?: OracleLoadError;
};
type OracleResponseMeta = {
  readiness: OracleReadiness;
};
type SimulationRecalculationState = {
  requestedVersion: number;
  runningVersion: number | null;
  publishedVersion: number;
  pending: boolean;
  running: boolean;
  lastUpdated: string | null;
  error: string | null;
};
type SimulationRecalculationSnapshot = {
  version: number;
  seed: string;
  ratings: Record<string, number>;
  teamMetrics: Record<string, TeamMetrics>;
  playedMatches: PlayedMatch[];
  modelConfig: ModelConfig;
};
type SimulationRunner = (snapshot: SimulationRecalculationSnapshot) => Promise<SimResult>;
type LiveDataProviderName = "espn" | "disabled";
type LiveDataOptions = FetchLiveTournamentFeedOptions & {
  provider?: LiveDataProviderName;
  refreshIntervalMs?: number;
};
type OracleInitOptions = LoadHistoricalDatasetOptions & {
  liveData?: LiveDataOptions;
};
type LiveDataCacheState = {
  provider: LiveDataProviderName;
  refreshIntervalMs: number;
  matches: PlayedMatch[];
  eliminatedTeams: Set<string>;
  metadata: LiveDataProviderMetadata | null;
  lastRefreshAttemptAt: string | null;
  error: string | null;
  running: boolean;
  signature: string | null;
};

const matchTeamsSchema = PredictMatchBody.strict().superRefine((payload, ctx) => {
  addTeamValidationIssues(payload, ctx);
});
const liveMatchSchema = RecordLiveMatchBody.strict().superRefine((payload, ctx) => {
  addTeamValidationIssues(payload, ctx);
  addScoreValidationIssues("homeScore", payload.homeScore, ctx);
  addScoreValidationIssues("awayScore", payload.awayScore, ctx);
});
const deleteLiveMatchSchema = DeleteLiveMatchBody.strict().superRefine((payload, ctx) => {
  addTeamValidationIssues(payload, ctx);
});

function addTeamValidationIssues(payload: MatchTeams, ctx: ValidationIssueContext): void {
  if (!TEAM_NAMES.has(payload.homeTeam)) {
    ctx.addIssue({
      code: "custom",
      path: ["homeTeam"],
      message: `Unknown team: ${payload.homeTeam}`,
    });
  }

  if (!TEAM_NAMES.has(payload.awayTeam)) {
    ctx.addIssue({
      code: "custom",
      path: ["awayTeam"],
      message: `Unknown team: ${payload.awayTeam}`,
    });
  }

  if (payload.homeTeam === payload.awayTeam) {
    ctx.addIssue({
      code: "custom",
      path: ["awayTeam"],
      message: "Teams must be different",
    });
  }
}

function addScoreValidationIssues(
  field: "homeScore" | "awayScore",
  score: number,
  ctx: ValidationIssueContext
): void {
  if (!Number.isInteger(score)) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `${field} must be an integer`,
    });
  }

  if (score < 0) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `${field} must be non-negative`,
    });
  }

  if (score > MAX_REASONABLE_SCORE) {
    ctx.addIssue({
      code: "custom",
      path: [field],
      message: `${field} must be ${MAX_REASONABLE_SCORE} or less`,
    });
  }
}

function parseBody<T>(schema: SafeParseSchema<T>, body: unknown): BodyParseResult<T> {
  const parsed = schema.safeParse(body);

  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  return {
    success: false,
    issues: parsed.error.issues.map(formatValidationIssue),
  };
}

function formatValidationIssue(issue: ZodLikeIssue): ApiErrorIssue {
  const path = issue.path.join(".");
  return {
    ...(path ? { path } : {}),
    message: issue.message,
    code: "invalid",
  };
}

function sendValidationError(res: Response, issues: ApiErrorIssue[]) {
  return sendApiError(res, 400, {
    code: "invalid_request",
    message: "Invalid request body",
    issues,
  });
}

function createSimulationSeed(): string {
  return randomUUID();
}

function parseOptionalSeed(seed: unknown): BodyParseResult<string | undefined> {
  if (seed === undefined) {
    return { success: true, data: undefined };
  }

  if (typeof seed !== "string") {
    return { success: false, issues: [{ path: "seed", message: "seed must be a single string" }] };
  }

  const trimmed = seed.trim();
  if (trimmed.length === 0) {
    return { success: false, issues: [{ path: "seed", message: "seed must not be empty" }] };
  }

  if (trimmed.length > MAX_SEED_LENGTH) {
    return {
      success: false,
      issues: [{ path: "seed", message: `seed must be ${MAX_SEED_LENGTH} characters or less` }],
    };
  }

  return { success: true, data: trimmed };
}

// ---- In-memory cache ----
interface OracleCache {
  ready: boolean;
  matchCount: number;
  ratings: Record<string, number>;
  teamMetrics: Record<string, TeamMetrics>;
  modelConfig: ModelConfig;
  simResult: SimResult | null;
  simulationSeed: string;
  recalculation: SimulationRecalculationState;
  dataset: HistoricalDatasetMetadata | null;
  loadingError: OracleLoadError | null;
  fixtureMatches: PlayedMatch[];
  liveData: LiveDataCacheState;
  playedMatches: PlayedMatch[];
}

function createInitialCache(): OracleCache {
  return {
    ready: false,
    matchCount: 0,
    ratings: {},
    teamMetrics: {},
    modelConfig: DEFAULT_MODEL_CONFIG,
    simResult: null,
    simulationSeed: createSimulationSeed(),
    recalculation: createInitialRecalculationState(),
    dataset: null,
    loadingError: null,
    fixtureMatches: [],
    liveData: createInitialLiveDataState(),
    playedMatches: [],
  };
}

const cache: OracleCache = createInitialCache();
let simulationRunner: SimulationRunner = runSimulationRecalculationInBatches;
let liveDataFetchOptions: FetchLiveTournamentFeedOptions = {};

function createInitialRecalculationState(): SimulationRecalculationState {
  return {
    requestedVersion: 0,
    runningVersion: null,
    publishedVersion: 0,
    pending: false,
    running: false,
    lastUpdated: null,
    error: null,
  };
}

function createInitialLiveDataState(): LiveDataCacheState {
  return {
    provider: "disabled",
    refreshIntervalMs: DEFAULT_LIVE_DATA_REFRESH_INTERVAL_MS,
    matches: [],
    eliminatedTeams: new Set(),
    metadata: null,
    lastRefreshAttemptAt: null,
    error: null,
    running: false,
    signature: null,
  };
}

function configureLiveData(options: LiveDataOptions | undefined): void {
  const provider = options?.provider ?? "espn";
  const refreshIntervalMs = Math.max(
    1_000,
    Math.trunc(options?.refreshIntervalMs ?? DEFAULT_LIVE_DATA_REFRESH_INTERVAL_MS)
  );

  cache.liveData = {
    ...createInitialLiveDataState(),
    provider,
    refreshIntervalMs,
  };
  liveDataFetchOptions = {
    fetchImpl: options?.fetchImpl,
    scoreboardUrl: options?.scoreboardUrl,
    standingsUrl: options?.standingsUrl,
    timeoutMs: options?.timeoutMs,
  };
}

function createZeroedSimulationResult(): SimResult {
  const emptyCounts = Object.fromEntries(WC2026_TEAMS.map((team) => [team.name, 0])) as Record<
    string,
    number
  >;

  return {
    titles: { ...emptyCounts },
    finals: { ...emptyCounts },
    semiFinals: { ...emptyCounts },
    quarterFinals: { ...emptyCounts },
    roundOf16: { ...emptyCounts },
    groupWins: { ...emptyCounts },
    groupAdvances: { ...emptyCounts },
  };
}

function mergeCountBuckets(
  left: Record<string, number>,
  right: Record<string, number>
): Record<string, number> {
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);

  return Object.fromEntries(
    [...names].map((name) => [name, (left[name] ?? 0) + (right[name] ?? 0)])
  );
}

function mergeSimulationResults(left: SimResult, right: SimResult): SimResult {
  return {
    titles: mergeCountBuckets(left.titles, right.titles),
    finals: mergeCountBuckets(left.finals, right.finals),
    semiFinals: mergeCountBuckets(left.semiFinals, right.semiFinals),
    quarterFinals: mergeCountBuckets(left.quarterFinals, right.quarterFinals),
    roundOf16: mergeCountBuckets(left.roundOf16, right.roundOf16),
    groupWins: mergeCountBuckets(left.groupWins, right.groupWins),
    groupAdvances: mergeCountBuckets(left.groupAdvances, right.groupAdvances),
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function runSimulationRecalculationInBatches(
  snapshot: SimulationRecalculationSnapshot
): Promise<SimResult> {
  let aggregate = createZeroedSimulationResult();
  let remaining = NUM_SIMULATIONS;
  const random = createSeededRng(snapshot.seed);

  while (remaining > 0) {
    const simulationsRun = Math.min(RECALCULATION_BATCH_SIZE, remaining);
    const partialResult = runSimulations(snapshot.ratings, snapshot.playedMatches, snapshot.teamMetrics, {
      random,
      simulationsRun,
      modelConfig: snapshot.modelConfig,
    });

    aggregate = mergeSimulationResults(aggregate, partialResult);
    remaining -= simulationsRun;

    if (remaining > 0) {
      await yieldToEventLoop();
    }
  }

  return aggregate;
}

function getMergedPlayedMatches(): PlayedMatch[] {
  const merged: PlayedMatch[] = cache.fixtureMatches.map((m) => ({ ...m }));

  for (const liveMatch of cache.liveData.matches) {
    upsertMatch(merged, { ...liveMatch });
  }

  for (const custom of cache.playedMatches) {
    const customMatch = { ...custom, source: "custom" as const, status: "finished" as const };
    const existing = findMatch(merged, custom.homeTeam, custom.awayTeam);
    if (existing && isLockedExternalMatch(existing)) continue;
    upsertMatch(merged, customMatch);
  }

  return merged;
}

function getSimulationMatches(): PlayedMatch[] {
  return getMergedPlayedMatches().filter(
    (m) => m.homeScore >= 0 && m.awayScore >= 0 && (m.status ?? "finished") === "finished"
  );
}

function createLiveDataSignature(matches: readonly PlayedMatch[], eliminatedTeams: ReadonlySet<string>): string {
  return JSON.stringify({
    matches: matches.map((match) => ({
      sourceId: match.sourceId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      statusDetail: match.statusDetail,
      winnerTeam: match.winnerTeam,
    })),
    eliminatedTeams: [...eliminatedTeams].sort(),
  });
}

function isSameMatchup(
  match: Pick<PlayedMatch, "homeTeam" | "awayTeam">,
  homeTeam: string,
  awayTeam: string
): boolean {
  return (
    (match.homeTeam === homeTeam && match.awayTeam === awayTeam) ||
    (match.homeTeam === awayTeam && match.awayTeam === homeTeam)
  );
}

function shouldRefreshLiveData(force: boolean): boolean {
  if (force) return true;
  if (!cache.liveData.lastRefreshAttemptAt) return true;

  const lastAttemptAt = new Date(cache.liveData.lastRefreshAttemptAt).getTime();
  return Date.now() - lastAttemptAt >= cache.liveData.refreshIntervalMs;
}

async function refreshLiveDataIfNeeded(
  options: { force?: boolean; scheduleRecalculation?: boolean } = {}
): Promise<void> {
  const force = options.force ?? false;
  const scheduleRecalculation = options.scheduleRecalculation ?? true;

  if (cache.liveData.provider === "disabled" || cache.liveData.running || !shouldRefreshLiveData(force)) {
    return;
  }

  cache.liveData = {
    ...cache.liveData,
    running: true,
    lastRefreshAttemptAt: new Date().toISOString(),
  };

  try {
    const feed = await fetchEspnTournamentFeed({
      ...liveDataFetchOptions,
      timeoutMs: liveDataFetchOptions.timeoutMs ?? 3_000,
    });
    const signature = createLiveDataSignature(feed.matches, feed.eliminatedTeams);
    const changed = signature !== cache.liveData.signature;

    cache.liveData = {
      ...cache.liveData,
      matches: feed.matches.map((match) => ({ ...match })),
      eliminatedTeams: new Set(feed.eliminatedTeams),
      metadata: feed.metadata,
      error: null,
      running: false,
      signature,
    };

    if (changed && scheduleRecalculation) {
      scheduleCachedSimulationRecalculation();
    }
  } catch (err) {
    logger.warn({ err }, "Live tournament data refresh failed; using local fixtures");
    cache.liveData = {
      ...cache.liveData,
      error: "Live tournament data refresh failed. Local fixtures and manual overrides remain available.",
      running: false,
    };
  }
}

function findMatch(matches: readonly PlayedMatch[], homeTeam: string, awayTeam: string): PlayedMatch | undefined {
  return matches.find((match) => isSameMatchup(match, homeTeam, awayTeam));
}

function upsertMatch(matches: PlayedMatch[], match: PlayedMatch): void {
  const idx = matches.findIndex((existingMatch) =>
    isSameMatchup(existingMatch, match.homeTeam, match.awayTeam)
  );

  if (idx !== -1) {
    matches[idx] = { ...matches[idx], ...match };
  } else {
    matches.push(match);
  }
}

function isLockedExternalMatch(match: PlayedMatch): boolean {
  return (match.source === "official" || match.source === "espn") && match.status !== "scheduled";
}

function recalculateCachedSimulation(): void {
  cache.simulationSeed = createSimulationSeed();
  cache.simResult = runSimulations(cache.ratings, getSimulationMatches(), cache.teamMetrics, {
    seed: cache.simulationSeed,
    modelConfig: cache.modelConfig,
  });
  cache.recalculation = {
    ...cache.recalculation,
    publishedVersion: cache.recalculation.requestedVersion,
    runningVersion: null,
    pending: false,
    running: false,
    lastUpdated: new Date().toISOString(),
    error: null,
  };
}

function getIsRecalculating(): boolean {
  return cache.recalculation.pending || cache.recalculation.running;
}

function formatSimulationRecalculationError(_error: unknown): string {
  return "Simulation recalculation failed. Last valid simulation results remain available.";
}

function createRecalculationSnapshot(version: number): SimulationRecalculationSnapshot {
  return {
    version,
    seed: createSimulationSeed(),
    ratings: { ...cache.ratings },
    teamMetrics: { ...cache.teamMetrics },
    playedMatches: getSimulationMatches().map((match) => ({ ...match })),
    modelConfig: { ...cache.modelConfig },
  };
}

function scheduleCachedSimulationRecalculation(): void {
  if (!cache.ready || !cache.simResult) {
    return;
  }

  cache.recalculation = {
    ...cache.recalculation,
    requestedVersion: cache.recalculation.requestedVersion + 1,
    pending: true,
    error: null,
  };

  if (!cache.recalculation.running) {
    void runNextSimulationRecalculation();
  }
}

async function runNextSimulationRecalculation(): Promise<void> {
  if (cache.recalculation.running || !cache.recalculation.pending) {
    return;
  }

  const version = cache.recalculation.requestedVersion;
  const snapshot = createRecalculationSnapshot(version);

  cache.recalculation = {
    ...cache.recalculation,
    pending: false,
    running: true,
    runningVersion: version,
  };

  await yieldToEventLoop();

  try {
    const simResult = await simulationRunner(snapshot);

    if (snapshot.version === cache.recalculation.requestedVersion) {
      cache.simResult = simResult;
      cache.simulationSeed = snapshot.seed;
      cache.recalculation = {
        ...cache.recalculation,
        publishedVersion: snapshot.version,
        runningVersion: null,
        running: false,
        lastUpdated: new Date().toISOString(),
        error: null,
      };
    } else {
      cache.recalculation = {
        ...cache.recalculation,
        runningVersion: null,
        running: false,
      };
    }
  } catch (err) {
    const message = formatSimulationRecalculationError(err);
    logger.error({ err, version: snapshot.version }, "Simulation recalculation failed");

    cache.recalculation = {
      ...cache.recalculation,
      runningVersion: null,
      running: false,
      error: snapshot.version === cache.recalculation.requestedVersion ? message : cache.recalculation.error,
    };
  }

  if (cache.recalculation.pending) {
    void runNextSimulationRecalculation();
  }
}

function getOracleState(): OracleState {
  if (cache.ready) {
    return "ready";
  }

  if (cache.loadingError) {
    return "error";
  }

  return "loading";
}

function formatOracleLoadError(_error: unknown): OracleLoadError {
  return {
    code: "HISTORICAL_DATA_LOAD_FAILED",
    message:
      "Historical match dataset could not be loaded. Predictions are unavailable until a dataset source loads.",
  };
}

function getOracleStatusMessage(state: OracleState, recalculating: boolean): string {
  if (state === "ready") {
    if (recalculating) {
      return "Oracle ready. Simulation recalculation running; last valid results remain available.";
    }

    if (cache.recalculation.error) {
      return "Oracle ready. Last valid simulation active; latest recalculation failed.";
    }

    return "Oracle ready. Elo + attack/defense Poisson match model and Monte Carlo tournament simulations active.";
  }

  if (cache.loadingError) {
    return cache.loadingError.message;
  }

  return "Loading historical match data and computing Elo ratings...";
}

function getOracleReadiness(): OracleReadiness {
  const state = getOracleState();

  return {
    state,
    ready: cache.ready,
    message: getOracleStatusMessage(state, getIsRecalculating()),
    ...(cache.loadingError ? { error: cache.loadingError } : {}),
  };
}

function getOracleResponseMeta(): OracleResponseMeta {
  return {
    readiness: getOracleReadiness(),
  };
}

function sendOracleSuccess<TData>(res: Response, data: TData) {
  return sendApiSuccess(res, data, getOracleResponseMeta());
}

export function resetOracleForTests(): void {
  Object.assign(cache, createInitialCache());
}

export function setSimulationRunnerForTests(runner: SimulationRunner): () => void {
  const previousRunner = simulationRunner;
  simulationRunner = runner;

  return () => {
    simulationRunner = previousRunner;
  };
}

export function seedReadyOracleForTests(
  overrides: {
    lastUpdated?: string;
    simulationSeed?: string;
    simResult?: SimResult;
    ratings?: Record<string, number>;
    teamMetrics?: Record<string, TeamMetrics>;
    fixtureMatches?: PlayedMatch[];
    liveDataMatches?: PlayedMatch[];
    eliminatedTeams?: string[];
    playedMatches?: PlayedMatch[];
  } = {}
): void {
  const fallbackRating = DEFAULT_MODEL_CONFIG.fallbackRating;
  const ratings =
    overrides.ratings ??
    (Object.fromEntries(WC2026_TEAMS.map((team) => [team.name, fallbackRating])) as Record<string, number>);
  const simulationSeed = overrides.simulationSeed ?? createSimulationSeed();

  Object.assign(cache, {
    ...createInitialCache(),
    ready: true,
    ratings,
    teamMetrics: overrides.teamMetrics ?? {},
    modelConfig: DEFAULT_MODEL_CONFIG,
    simResult: overrides.simResult ?? createZeroedSimulationResult(),
    simulationSeed,
    recalculation: {
      ...createInitialRecalculationState(),
      lastUpdated: overrides.lastUpdated ?? new Date().toISOString(),
    },
    fixtureMatches: overrides.fixtureMatches ?? [],
    liveData: {
      ...createInitialLiveDataState(),
      matches: overrides.liveDataMatches ?? [],
      eliminatedTeams: new Set(overrides.eliminatedTeams ?? []),
    },
    playedMatches: overrides.playedMatches ?? [],
  });
}

// ---- Initialize on startup ----
export async function initOracle(options: OracleInitOptions = {}): Promise<void> {
  cache.ready = false;
  cache.loadingError = null;
  configureLiveData(options.liveData);

  try {
    const {
      ratings: allRatings,
      teamMetrics,
      matchCount,
      fixtureMatches,
      dataset,
      modelConfig,
    } = await computeEloRatings(options);
    const wcRatings = getWCTeamRatings(allRatings);
    cache.matchCount = matchCount;
    cache.ratings = wcRatings;
    cache.teamMetrics = teamMetrics;
    cache.modelConfig = modelConfig;
    cache.fixtureMatches = fixtureMatches;
    cache.dataset = dataset;

    await refreshLiveDataIfNeeded({ force: true, scheduleRecalculation: false });
    recalculateCachedSimulation();
    cache.ready = true;
  } catch (err) {
    cache.ready = false;
    cache.loadingError = formatOracleLoadError(err);
    logger.error({ err }, "Oracle init failed");
  }
}

// ---- Routes ----

router.get("/oracle/status", (req, res) => {
  const state = getOracleState();
  const recalculating = getIsRecalculating();
  const message = getOracleStatusMessage(state, recalculating);

  return sendOracleSuccess(res, {
    state,
    ready: cache.ready,
    matchesLoaded: cache.matchCount,
    teamsRated: Object.keys(cache.ratings).length,
    simulationsRun: cache.ready ? NUM_SIMULATIONS : 0,
    simulationSeed: cache.simulationSeed,
    liveMatchesRecorded: cache.playedMatches.length,
    liveDataProvider: cache.liveData.provider,
    liveDataMatchesLoaded: cache.liveData.matches.length,
    liveDataLastSyncedAt: cache.liveData.metadata?.loadedAt ?? null,
    liveDataError: cache.liveData.error,
    eliminatedTeams: [...cache.liveData.eliminatedTeams].sort(),
    recalculating,
    lastUpdated: cache.recalculation.lastUpdated,
    recalculationError: cache.recalculation.error,
    dataset: cache.dataset,
    activeModel: cache.modelConfig.variant,
    error: cache.loadingError ?? undefined,
    message,
  });
});

router.post("/oracle/live-match", mutableRateLimiter, (req, res) => {
  const parsed = parseBody<LiveMatchInput>(liveMatchSchema, req.body);

  if (!parsed.success) {
    return sendValidationError(res, parsed.issues);
  }

  const { homeTeam, awayTeam, homeScore, awayScore } = parsed.data;
  const existingMatch = findMatch(getMergedPlayedMatches(), homeTeam, awayTeam);

  if (existingMatch && isLockedExternalMatch(existingMatch)) {
    return sendApiError(res, 409, {
      code: "match_locked",
      message:
        "This match already has an external live or final result. Manual scenario overrides are only allowed for unplayed matches.",
    });
  }

  // Record manual scenario override.
  cache.playedMatches = [
    ...cache.playedMatches.filter((match) => !isSameMatchup(match, homeTeam, awayTeam)),
    { homeTeam, awayTeam, homeScore, awayScore, source: "custom", status: "finished" },
  ];

  // Queue recalculation so the request can return while the last valid simulation stays available.
  scheduleCachedSimulationRecalculation();

  return sendOracleSuccess(res, {
    success: true,
    message: `Recorded manual scenario override: ${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}`,
    liveMatchesCount: cache.playedMatches.length,
  });
});

router.delete("/oracle/live-match", mutableRateLimiter, (req, res) => {
  const parsed = parseBody<MatchTeams>(deleteLiveMatchSchema, req.body);

  if (!parsed.success) {
    return sendValidationError(res, parsed.issues);
  }

  const { homeTeam, awayTeam } = parsed.data;

  cache.playedMatches = cache.playedMatches.filter((match) => !isSameMatchup(match, homeTeam, awayTeam));

  // Queue recalculation so the request can return while the last valid simulation stays available.
  scheduleCachedSimulationRecalculation();

  return sendOracleSuccess(res, {
    success: true,
    liveMatchesCount: cache.playedMatches.length,
  });
});

router.get("/oracle/live-matches", async (req, res) => {
  if (cache.ready) {
    await refreshLiveDataIfNeeded();
  }

  return sendOracleSuccess(res, {
    playedMatches: getMergedPlayedMatches(),
    source: {
      provider: cache.liveData.provider,
      lastSyncedAt: cache.liveData.metadata?.loadedAt ?? null,
      error: cache.liveData.error,
    },
  });
});

router.post("/oracle/live-matches/clear", mutableRateLimiter, (req, res) => {
  cache.playedMatches = [];
  scheduleCachedSimulationRecalculation();

  return sendOracleSuccess(res, {
    success: true,
    message: "All manual scenario overrides cleared",
  });
});

router.get("/oracle/teams", (req, res) => {
  const teams = WC2026_TEAMS.map((t) => ({
    name: t.name,
    code: t.code,
    elo: cache.ratings[t.name] ?? cache.modelConfig.fallbackRating,
    group: t.group,
    flagEmoji: t.flagEmoji,
    attackStrength: cache.teamMetrics[t.name]?.attackStrength ?? 1.0,
    defenseStrength: cache.teamMetrics[t.name]?.defenseStrength ?? 1.0,
  })).sort((a, b) => b.elo - a.elo);

  return sendOracleSuccess(res, { teams });
});

router.get("/oracle/simulation", async (req, res) => {
  const parsedSeed = parseOptionalSeed(req.query.seed);

  if (!parsedSeed.success) {
    return sendValidationError(res, parsedSeed.issues);
  }

  const requestedSeed = parsedSeed.data;
  const simulationSeed = requestedSeed ?? cache.simulationSeed;
  const uncertainty = getSimulationUncertaintyMetadata(NUM_SIMULATIONS);

  if (cache.ready) {
    await refreshLiveDataIfNeeded();
  }

  if (!cache.ready || !cache.simResult) {
    return sendOracleSuccess(res, {
      results: [],
      simulationsRun: 0,
      simulationSeed,
      liveMatchesRecorded: 0,
      uncertainty: getSimulationUncertaintyMetadata(0),
    });
  }

  const simResult = requestedSeed
    ? runSimulations(cache.ratings, getSimulationMatches(), cache.teamMetrics, {
        seed: requestedSeed,
        modelConfig: cache.modelConfig,
      })
    : cache.simResult;
  const results = toPublishedSimulationResults(
    simResult,
    cache.ratings,
    NUM_SIMULATIONS,
    cache.liveData.eliminatedTeams,
    cache.modelConfig
  );

  return sendOracleSuccess(res, {
    results,
    simulationsRun: NUM_SIMULATIONS,
    simulationSeed,
    liveMatchesRecorded: cache.playedMatches.length,
    eliminatedTeams: [...cache.liveData.eliminatedTeams].sort(),
    uncertainty,
  });
});

router.post("/oracle/predict-match", (req, res) => {
  const parsed = parseBody<MatchPredictionInput>(matchTeamsSchema, req.body);

  if (!parsed.success) {
    return sendValidationError(res, parsed.issues);
  }

  const { homeTeam, awayTeam, neutral = true, isHomeA = false, isHomeB = false } = parsed.data;

  const eloHome = cache.ratings[homeTeam] ?? cache.modelConfig.fallbackRating;
  const eloAway = cache.ratings[awayTeam] ?? cache.modelConfig.fallbackRating;
  const metricsHome = cache.teamMetrics[homeTeam];
  const metricsAway = cache.teamMetrics[awayTeam];

  const { pWinA, pDraw, pWinB, xgA, xgB, mostLikelyScore } = matchProbabilities(
    eloHome,
    eloAway,
    undefined,
    metricsHome,
    metricsAway,
    isHomeA,
    isHomeB,
    neutral,
    {},
    cache.modelConfig
  );

  return sendOracleSuccess(res, {
    homeTeam,
    awayTeam,
    homeWinPct: Math.round(pWinA * 1000) / 10,
    drawPct: Math.round(pDraw * 1000) / 10,
    awayWinPct: Math.round(pWinB * 1000) / 10,
    homeExpectedGoals: xgA,
    awayExpectedGoals: xgB,
    mostLikelyScore,
    homeElo: eloHome,
    awayElo: eloAway,
    homeAttackStrength: metricsHome?.attackStrength ?? 1.0,
    homeDefenseStrength: metricsHome?.defenseStrength ?? 1.0,
    awayAttackStrength: metricsAway?.attackStrength ?? 1.0,
    awayDefenseStrength: metricsAway?.defenseStrength ?? 1.0,
  });
});

export default router;
