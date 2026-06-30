import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { DeleteLiveMatchBody, PredictMatchBody, RecordLiveMatchBody } from "@workspace/api-zod";
import {
  computeEloRatings,
  getWCTeamRatings,
  type HistoricalDatasetMetadata,
  type LoadHistoricalDatasetOptions,
  type TeamMetrics,
} from "../lib/elo.js";
import { logger } from "../lib/logger.js";
import {
  NUM_SIMULATIONS,
  createSeededRng,
  runSimulations,
  matchProbabilities,
  getHomeStatus,
  getSimulationUncertaintyMetadata,
  toPublishedSimulationResults,
  type SimResult,
  type PlayedMatch,
} from "../lib/simulation.js";
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
};
type SimulationRunner = (snapshot: SimulationRecalculationSnapshot) => Promise<SimResult>;

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
  simResult: SimResult | null;
  simulationSeed: string;
  recalculation: SimulationRecalculationState;
  dataset: HistoricalDatasetMetadata | null;
  loadingError: OracleLoadError | null;
  fixtureMatches: PlayedMatch[];
  playedMatches: PlayedMatch[];
}

function createInitialCache(): OracleCache {
  return {
    ready: false,
    matchCount: 0,
    ratings: {},
    teamMetrics: {},
    simResult: null,
    simulationSeed: createSimulationSeed(),
    recalculation: createInitialRecalculationState(),
    dataset: null,
    loadingError: null,
    fixtureMatches: [],
    playedMatches: [],
  };
}

const cache: OracleCache = createInitialCache();
let simulationRunner: SimulationRunner = runSimulationRecalculationInBatches;

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

  for (const custom of cache.playedMatches) {
    const customMatch = { ...custom, source: "custom" as const, status: "finished" as const };
    const idx = merged.findIndex(
      (m) =>
        (m.homeTeam === custom.homeTeam && m.awayTeam === custom.awayTeam) ||
        (m.homeTeam === custom.awayTeam && m.awayTeam === custom.homeTeam)
    );
    if (idx !== -1) {
      merged[idx] = { ...merged[idx], ...customMatch };
    } else {
      merged.push(customMatch);
    }
  }

  return merged;
}

function getSimulationMatches(): PlayedMatch[] {
  return getMergedPlayedMatches().filter((m) => m.homeScore >= 0 && m.awayScore >= 0);
}

function recalculateCachedSimulation(): void {
  cache.simulationSeed = createSimulationSeed();
  cache.simResult = runSimulations(cache.ratings, getSimulationMatches(), cache.teamMetrics, {
    seed: cache.simulationSeed,
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

    return "Oracle ready. Dixon-Coles & Monte Carlo simulations active.";
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
    playedMatches?: PlayedMatch[];
  } = {}
): void {
  const ratings =
    overrides.ratings ??
    (Object.fromEntries(WC2026_TEAMS.map((team) => [team.name, 1000])) as Record<string, number>);
  const simulationSeed = overrides.simulationSeed ?? createSimulationSeed();

  Object.assign(cache, {
    ...createInitialCache(),
    ready: true,
    ratings,
    teamMetrics: overrides.teamMetrics ?? {},
    simResult: overrides.simResult ?? createZeroedSimulationResult(),
    simulationSeed,
    recalculation: {
      ...createInitialRecalculationState(),
      lastUpdated: overrides.lastUpdated ?? new Date().toISOString(),
    },
    fixtureMatches: overrides.fixtureMatches ?? [],
    playedMatches: overrides.playedMatches ?? [],
  });
}

// ---- Initialize on startup ----
export async function initOracle(options: LoadHistoricalDatasetOptions = {}): Promise<void> {
  cache.ready = false;
  cache.loadingError = null;

  try {
    const {
      ratings: allRatings,
      teamMetrics,
      matchCount,
      fixtureMatches,
      dataset,
    } = await computeEloRatings(options);
    const wcRatings = getWCTeamRatings(allRatings);
    cache.matchCount = matchCount;
    cache.ratings = wcRatings;
    cache.teamMetrics = teamMetrics;
    cache.fixtureMatches = fixtureMatches;
    cache.dataset = dataset;

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
    recalculating,
    lastUpdated: cache.recalculation.lastUpdated,
    recalculationError: cache.recalculation.error,
    dataset: cache.dataset,
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

  // Record manual scenario override.
  cache.playedMatches = [
    ...cache.playedMatches.filter((m) => !(m.homeTeam === homeTeam && m.awayTeam === awayTeam)),
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

  cache.playedMatches = cache.playedMatches.filter(
    (m) => !(m.homeTeam === homeTeam && m.awayTeam === awayTeam)
  );

  // Queue recalculation so the request can return while the last valid simulation stays available.
  scheduleCachedSimulationRecalculation();

  return sendOracleSuccess(res, {
    success: true,
    liveMatchesCount: cache.playedMatches.length,
  });
});

router.get("/oracle/live-matches", (req, res) => {
  return sendOracleSuccess(res, {
    playedMatches: getMergedPlayedMatches(),
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
    elo: cache.ratings[t.name] ?? 1000,
    group: t.group,
    flagEmoji: t.flagEmoji,
    attackStrength: cache.teamMetrics[t.name]?.attackStrength ?? 1.0,
    defenseStrength: cache.teamMetrics[t.name]?.defenseStrength ?? 1.0,
  })).sort((a, b) => b.elo - a.elo);

  return sendOracleSuccess(res, { teams });
});

router.get("/oracle/simulation", (req, res) => {
  const parsedSeed = parseOptionalSeed(req.query.seed);

  if (!parsedSeed.success) {
    return sendValidationError(res, parsedSeed.issues);
  }

  const requestedSeed = parsedSeed.data;
  const simulationSeed = requestedSeed ?? cache.simulationSeed;
  const uncertainty = getSimulationUncertaintyMetadata(NUM_SIMULATIONS);

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
    ? runSimulations(cache.ratings, getSimulationMatches(), cache.teamMetrics, { seed: requestedSeed })
    : cache.simResult;
  const results = toPublishedSimulationResults(simResult, cache.ratings, NUM_SIMULATIONS);

  return sendOracleSuccess(res, {
    results,
    simulationsRun: NUM_SIMULATIONS,
    simulationSeed,
    liveMatchesRecorded: cache.playedMatches.length,
    uncertainty,
  });
});

router.post("/oracle/predict-match", (req, res) => {
  const parsed = parseBody<MatchTeams>(matchTeamsSchema, req.body);

  if (!parsed.success) {
    return sendValidationError(res, parsed.issues);
  }

  const { homeTeam, awayTeam } = parsed.data;

  const eloHome = cache.ratings[homeTeam] ?? 1000;
  const eloAway = cache.ratings[awayTeam] ?? 1000;
  const metricsHome = cache.teamMetrics[homeTeam];
  const metricsAway = cache.teamMetrics[awayTeam];

  const { isHomeA, isHomeB } = getHomeStatus(homeTeam, awayTeam, "R32");
  const { pWinA, pDraw, pWinB, xgA, xgB, mostLikelyScore } = matchProbabilities(
    eloHome,
    eloAway,
    undefined,
    metricsHome,
    metricsAway,
    isHomeA,
    isHomeB
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
