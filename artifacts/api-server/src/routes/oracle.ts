import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { Router, type Response } from "express";
import { MODEL_VARIANTS } from "@workspace/oracle-model";
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
  createMatchContextService,
  type MatchContextFixture,
  type MatchContextService,
} from "../lib/match-context.js";
import {
  NUM_SIMULATIONS,
  matchProbabilities,
  getSimulationUncertaintyMetadata,
  toPublishedSimulationResults,
  type SimResult,
  type PlayedMatch,
} from "../lib/simulation.js";
import type {
  SimulationWorkerErrorPayload,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
  SimulationWorkerSnapshot,
} from "../lib/simulation.worker.js";
import { WC2026_SQUADS, type TeamSquad } from "../lib/squads-data.js";
import {
  createLiveTournamentFeedProvider,
  type FetchLiveTournamentFeedOptions,
  type LiveDataProvider,
  type LiveDataProviderMetadata,
  type LiveTournamentFeedProvider,
} from "../lib/live-results.js";
import {
  createOptionalApiFootballSquadsProvider,
  type ApiFootballSquadsProvider,
  type ApiFootballSquadsProvenance,
  type CreateApiFootballSquadsProviderOptions,
} from "../lib/api-football.js";
import { getFixtureByTeams, WC2026_TEAMS } from "../lib/worldcup2026.js";
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
const MAX_CUSTOM_MATCHES = 104;
const DEFAULT_SIMULATION_WORKER_TIMEOUT_MS = 120_000;
const DEFAULT_LIVE_DATA_REFRESH_INTERVAL_MS = 30_000;
const TEAM_NAMES = new Set(WC2026_TEAMS.map((team) => team.name));
const BEST_MODEL_CONFIG_FILENAME = "best-model-config.json";
const SOURCE_BEST_MODEL_CONFIG_URL = new URL(`../data/${BEST_MODEL_CONFIG_FILENAME}`, import.meta.url);
const REPO_SOURCE_BEST_MODEL_CONFIG_URL = new URL(
  `../src/data/${BEST_MODEL_CONFIG_FILENAME}`,
  import.meta.url
);
const BUNDLED_BEST_MODEL_CONFIG_URL = new URL(`./data/${BEST_MODEL_CONFIG_FILENAME}`, import.meta.url);

type ValidationIssuePath = Array<string | number>;
type UnknownRecord = Record<string, unknown>;
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
  [K in keyof SimulationWorkerSnapshot]: SimulationWorkerSnapshot[K];
};
type SimulationRunner = (
  snapshot: SimulationRecalculationSnapshot,
) => Promise<SimResult>;
type SimulationWorkerOptions = {
  workerUrl: URL;
  timeoutMs: number;
  simulationsRun: number;
};
type LiveDataProviderName = LiveDataProvider | "disabled";
type LiveDataOptions = FetchLiveTournamentFeedOptions & {
  provider?: LiveDataProviderName;
  refreshIntervalMs?: number;
};
type OracleInitOptions = LoadHistoricalDatasetOptions & {
  liveData?: LiveDataOptions;
  apiFootball?: CreateApiFootballSquadsProviderOptions;
  bestModelConfigPath?: string | URL;
};
type LiveDataCacheState = {
  provider: LiveDataProviderName;
  cacheTtlMs: number;
  matches: PlayedMatch[];
  eliminatedTeams: Set<string>;
  metadata: LiveDataProviderMetadata | null;
  running: boolean;
  signature: string | null;
};
type LiveDataStatus = {
  provider: LiveDataProviderName;
  state: LiveDataProviderMetadata["state"] | "disabled";
  loadedAt: string | null;
  sourceUrl: string | null;
  standingsUrl: string | null;
  cacheTtlMs: number;
  stale: boolean;
  error: string | null;
  fallback: LiveDataProviderMetadata["fallback"];
  matchCount: number;
  eliminatedTeamCount: number;
};
type LocalSquadsProvenance = {
  provider: "local-snapshot";
  loadedAt: string | null;
  sourceEndpoint: string;
  cacheTtlMs: number | null;
  stale: boolean;
  error: string | null;
  state: "disabled";
  fallback: "local-data";
};
type SquadsDataProvenance = ApiFootballSquadsProvenance | LocalSquadsProvenance;

const matchTeamsSchema = PredictMatchBody.strict().superRefine((payload, ctx) => {
  addTeamValidationIssues(payload, ctx);
});
const liveMatchSchema = RecordLiveMatchBody.strict().superRefine((payload, ctx) => {
  addTeamValidationIssues(payload, ctx);
  addScoreValidationIssues("homeScore", payload.homeScore, ctx);
  addScoreValidationIssues("awayScore", payload.awayScore, ctx);
});
const matchContextQuerySchema = PredictMatchBody.pick({
  homeTeam: true,
  awayTeam: true,
})
  .strict()
  .superRefine((payload, ctx) => {
    addTeamValidationIssues(payload, ctx);
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

function parseOptionalBooleanQueryFlag(
  value: unknown,
  field: string
): BodyParseResult<boolean> {
  if (value === undefined) {
    return { success: true, data: false };
  }

  if (Array.isArray(value)) {
    return { success: false, issues: [{ path: field, message: `${field} must be a single boolean` }] };
  }

  if (value === true || value === "true") {
    return { success: true, data: true };
  }

  if (value === false || value === "false") {
    return { success: true, data: false };
  }

  return {
    success: false,
    issues: [{ path: field, message: `${field} must be true or false` }],
  };
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
let liveDataProvider: LiveTournamentFeedProvider | null = null;
let matchContextService: MatchContextService = createMatchContextService();
let apiFootballSquadsProvider: ApiFootballSquadsProvider | null = null;

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
    cacheTtlMs: DEFAULT_LIVE_DATA_REFRESH_INTERVAL_MS,
    matches: [],
    eliminatedTeams: new Set(),
    metadata: null,
    running: false,
    signature: null,
  };
}

function configureLiveData(options: LiveDataOptions | undefined): void {
  const provider = options?.provider ?? "espn";
  const cacheTtlMs = Math.max(
    1_000,
    Math.trunc(options?.refreshIntervalMs ?? DEFAULT_LIVE_DATA_REFRESH_INTERVAL_MS)
  );

  cache.liveData = {
    ...createInitialLiveDataState(),
    provider,
    cacheTtlMs,
  };
  liveDataProvider =
    provider === "disabled"
      ? null
      : createLiveTournamentFeedProvider({
          fetchImpl: options?.fetchImpl,
          scoreboardUrl: options?.scoreboardUrl,
          standingsUrl: options?.standingsUrl,
          timeoutMs: options?.timeoutMs,
          cacheTtlMs,
        });

  if (liveDataProvider) {
    cache.liveData.metadata = liveDataProvider.peek().metadata;
  }
}

function configureApiFootballSquads(options: CreateApiFootballSquadsProviderOptions | undefined): void {
  apiFootballSquadsProvider = createOptionalApiFootballSquadsProvider(options);
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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

class SimulationWorkerExecutionError extends Error {
  readonly code = "simulation_worker_failed";
  readonly status = 500;
  readonly statusCode = 500;

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "SimulationWorkerExecutionError";
  }
}

class SimulationWorkerTimeoutError extends Error {
  readonly code = "simulation_worker_timeout";
  readonly status = 504;
  readonly statusCode = 504;

  constructor(timeoutMs: number) {
    super(`Simulation worker timed out after ${timeoutMs}ms`);
    this.name = "SimulationWorkerTimeoutError";
  }
}

function createDefaultSimulationWorkerOptions(): SimulationWorkerOptions {
  return {
    workerUrl: getDefaultSimulationWorkerUrl(),
    timeoutMs: DEFAULT_SIMULATION_WORKER_TIMEOUT_MS,
    simulationsRun: NUM_SIMULATIONS,
  };
}

function getDefaultSimulationWorkerUrl(): URL {
  const moduleUrl = new URL(import.meta.url);

  if (moduleUrl.pathname.endsWith("/src/routes/oracle.ts")) {
    return new URL("../../dist/lib/simulation.worker.mjs", import.meta.url);
  }

  return new URL("./lib/simulation.worker.mjs", import.meta.url);
}

function cloneSimulationWorkerOptions(
  options: SimulationWorkerOptions,
): SimulationWorkerOptions {
  return {
    workerUrl: new URL(options.workerUrl.href),
    timeoutMs: options.timeoutMs,
    simulationsRun: options.simulationsRun,
  };
}

function createWorkerResponseError(
  error: SimulationWorkerErrorPayload,
): SimulationWorkerExecutionError {
  const workerError = new SimulationWorkerExecutionError(
    `Simulation worker failed: ${error.message}`,
  );

  workerError.stack = error.stack;
  return workerError;
}

function isSimulationWorkerResponse(
  message: unknown,
): message is SimulationWorkerResponse {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as Partial<SimulationWorkerResponse>;
  return (
    (candidate.type === "simulation-complete" ||
      candidate.type === "simulation-error") &&
    typeof candidate.requestId === "string"
  );
}

function runSimulationRecalculationInWorker(
  snapshot: SimulationRecalculationSnapshot,
): Promise<SimResult> {
  const options = cloneSimulationWorkerOptions(simulationWorkerOptions);

  return new Promise((resolve, reject) => {
    let settled = false;
    const requestId = randomUUID();
    const worker = new Worker(options.workerUrl, {
      name: `oracle-simulation-${snapshot.version}`,
    });

    const timeout = setTimeout(() => {
      settleReject(new SimulationWorkerTimeoutError(options.timeoutMs));
      void worker.terminate().catch((err) => {
        logger.warn({ err }, "Failed to terminate timed-out simulation worker");
      });
    }, options.timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      worker.off("message", handleMessage);
      worker.off("error", handleError);
      worker.off("exit", handleExit);
    }

    function settleResolve(result: SimResult): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(result);
    }

    function settleReject(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function handleMessage(message: unknown): void {
      if (!isSimulationWorkerResponse(message)) {
        settleReject(
          new SimulationWorkerExecutionError(
            "Simulation worker posted an invalid response",
          ),
        );
        void worker.terminate();
        return;
      }

      if (message.requestId !== requestId) {
        settleReject(
          new SimulationWorkerExecutionError(
            "Simulation worker posted a response for an unknown request",
          ),
        );
        void worker.terminate();
        return;
      }

      if (message.type === "simulation-error") {
        settleReject(createWorkerResponseError(message.error));
        return;
      }

      settleResolve(message.result);
    }

    function handleError(error: Error): void {
      settleReject(
        new SimulationWorkerExecutionError(
          `Simulation worker crashed: ${error.message}`,
          { cause: error },
        ),
      );
    }

    function handleExit(code: number): void {
      if (settled) {
        return;
      }

      settleReject(
        new SimulationWorkerExecutionError(
          code === 0
            ? "Simulation worker exited before posting a result"
            : `Simulation worker exited with code ${code}`,
        ),
      );
    }

    worker.once("message", handleMessage);
    worker.once("error", handleError);
    worker.once("exit", handleExit);

    try {
      const request: SimulationWorkerRequest = {
        type: "run-simulations",
        requestId,
        snapshot,
        simulationsRun: options.simulationsRun,
      };
      worker.postMessage(request);
    } catch (error) {
      settleReject(
        new SimulationWorkerExecutionError(
          `Simulation worker request could not be posted: ${getErrorMessage(error)}`,
          { cause: error },
        ),
      );
      void worker.terminate();
    }
  });
}

function toFinishedCustomMatch(custom: LiveMatchInput): PlayedMatch {
  return {
    homeTeam: custom.homeTeam,
    awayTeam: custom.awayTeam,
    homeScore: custom.homeScore,
    awayScore: custom.awayScore,
    source: "custom",
    status: "finished",
  };
}

function getMergedPlayedMatches(
  customMatches: readonly LiveMatchInput[] = [],
): PlayedMatch[] {
  const merged: PlayedMatch[] = cache.fixtureMatches.map((m) => ({ ...m }));

  for (const liveMatch of cache.liveData.matches) {
    upsertMatch(merged, { ...liveMatch });
  }

  for (const custom of customMatches) {
    const customMatch = toFinishedCustomMatch(custom);
    const existing = findMatch(merged, custom.homeTeam, custom.awayTeam);
    if (existing && isLockedExternalMatch(existing)) continue;
    upsertMatch(merged, customMatch);
  }

  return merged;
}

function getSimulationMatches(
  customMatches: readonly LiveMatchInput[] = [],
): PlayedMatch[] {
  return getMergedPlayedMatches(customMatches).filter(
    (m) =>
      m.homeScore >= 0 &&
      m.awayScore >= 0 &&
      (m.status ?? "finished") === "finished",
  );
}

function createLiveDataSignature(
  matches: readonly PlayedMatch[],
  eliminatedTeams: ReadonlySet<string>,
): string {
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

async function refreshLiveDataIfNeeded(
  options: { force?: boolean; scheduleRecalculation?: boolean } = {}
): Promise<void> {
  const force = options.force ?? false;
  const scheduleRecalculation = options.scheduleRecalculation ?? true;

  if (cache.liveData.provider === "disabled" || cache.liveData.running || !liveDataProvider) {
    return;
  }

  cache.liveData = {
    ...cache.liveData,
    running: true,
  };

  try {
    const feed = await liveDataProvider.read({ force });
    const signature = createLiveDataSignature(feed.matches, feed.eliminatedTeams);
    const changed = signature !== cache.liveData.signature;

    cache.liveData = {
      ...cache.liveData,
      matches: feed.matches.map((match) => ({ ...match })),
      eliminatedTeams: new Set(feed.eliminatedTeams),
      metadata: feed.metadata,
      running: false,
      signature,
    };

    if (changed && scheduleRecalculation) {
      scheduleCachedSimulationRecalculation();
    }
  } catch (err) {
    logger.warn({ err }, "Live tournament data provider failed unexpectedly; using local fixtures");
    cache.liveData = {
      ...cache.liveData,
      metadata: liveDataProvider.peek().metadata,
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

function toMatchContextFixture(match: PlayedMatch): MatchContextFixture | null {
  if (!match.date || !match.kickoffTimeEt) {
    return null;
  }

  return {
    matchNumber: match.matchNumber,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    stage: match.stage,
    source: match.source,
    sourceId: match.sourceId,
    date: match.date,
    kickoffTimeEt: match.kickoffTimeEt,
    status: match.status,
    group: match.group,
    venue: match.venue,
    region: match.region,
  };
}

function findMatchContextFixture(homeTeam: string, awayTeam: string): MatchContextFixture | null {
  const cachedFixture = cache.fixtureMatches.find((match) => isSameMatchup(match, homeTeam, awayTeam));
  const fromCache = cachedFixture ? toMatchContextFixture(cachedFixture) : null;

  if (fromCache) {
    return fromCache;
  }

  const fixture = getFixtureByTeams(homeTeam, awayTeam);
  if (!fixture) {
    return null;
  }

  return {
    matchNumber: fixture.matchNumber,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    stage: fixture.stage,
    source: "fixture",
    sourceId: fixture.sourceId,
    date: fixture.date,
    kickoffTimeEt: fixture.kickoffTimeEt,
    status: fixture.status,
    group: fixture.group,
    venue: fixture.venue,
    region: fixture.region,
  };
}

async function recalculateCachedSimulation(): Promise<void> {
  const snapshot = createRecalculationSnapshot(cache.recalculation.requestedVersion);

  cache.recalculation = {
    ...cache.recalculation,
    pending: false,
    running: true,
    runningVersion: snapshot.version,
    error: null,
  };

  try {
    cache.simResult = await simulationRunner(snapshot);
    cache.simulationSeed = snapshot.seed;
    cache.recalculation = {
      ...cache.recalculation,
      publishedVersion: snapshot.version,
      runningVersion: null,
      pending: false,
      running: false,
      lastUpdated: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    cache.recalculation = {
      ...cache.recalculation,
      runningVersion: null,
      pending: false,
      running: false,
      error: formatSimulationRecalculationError(error),
    };
    throw error;
  }
}

function getIsRecalculating(): boolean {
  return cache.recalculation.pending || cache.recalculation.running;
}

function formatSimulationRecalculationError(_error: unknown): string {
  return "Simulation recalculation failed. Last valid simulation results remain available.";
}

function createRecalculationSnapshot(
  version: number,
): SimulationRecalculationSnapshot {
  return createSimulationSnapshot(version, createSimulationSeed(), []);
}

function createSimulationSnapshot(
  version: number,
  seed: string,
  customMatches: readonly LiveMatchInput[],
): SimulationRecalculationSnapshot {
  return {
    version,
    seed,
    ratings: { ...cache.ratings },
    teamMetrics: { ...cache.teamMetrics },
    playedMatches: getSimulationMatches(customMatches).map((match) => ({
      ...match,
    })),
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

function getLiveDataStatus(): LiveDataStatus {
  if (cache.liveData.provider === "disabled") {
    return {
      provider: "disabled",
      state: "disabled",
      loadedAt: null,
      sourceUrl: null,
      standingsUrl: null,
      cacheTtlMs: cache.liveData.cacheTtlMs,
      stale: false,
      error: null,
      fallback: "none",
      matchCount: 0,
      eliminatedTeamCount: 0,
    };
  }

  const metadata = cache.liveData.metadata ?? liveDataProvider?.peek().metadata;

  if (!metadata) {
    return {
      provider: cache.liveData.provider,
      state: "idle",
      loadedAt: null,
      sourceUrl: null,
      standingsUrl: null,
      cacheTtlMs: cache.liveData.cacheTtlMs,
      stale: false,
      error: null,
      fallback: "none",
      matchCount: 0,
      eliminatedTeamCount: 0,
    };
  }

  return {
    provider: metadata.provider,
    state: metadata.state,
    loadedAt: metadata.loadedAt,
    sourceUrl: metadata.sourceUrl,
    standingsUrl: metadata.standingsUrl,
    cacheTtlMs: metadata.cacheTtlMs,
    stale: metadata.stale,
    error: metadata.error,
    fallback: metadata.fallback,
    matchCount: metadata.matchCount,
    eliminatedTeamCount: metadata.eliminatedTeamCount,
  };
}

function getLocalSquadsProvenance(): LocalSquadsProvenance {
  return {
    provider: "local-snapshot",
    loadedAt: null,
    sourceEndpoint: WC2026_SQUADS.provenance.sourceUrl,
    cacheTtlMs: null,
    stale: false,
    error: null,
    state: "disabled",
    fallback: "local-data",
  };
}

function formatSquadsData(
  squads: readonly TeamSquad[],
  externalProvenance: SquadsDataProvenance
) {
  return {
    schemaVersion: WC2026_SQUADS.schemaVersion,
    version: WC2026_SQUADS.version,
    competition: WC2026_SQUADS.competition,
    provenance: {
      ...WC2026_SQUADS.provenance,
      notes: [...WC2026_SQUADS.provenance.notes],
    },
    externalProvenance: {
      ...externalProvenance,
    },
    squads: squads.map((squad) => ({
      team: squad.team,
      code: squad.code,
      group: squad.group,
      flagEmoji: squad.flagEmoji,
      completeness: {
        status: squad.completeness.status,
        expectedPlayerCount: squad.completeness.expectedPlayerCount,
        playerCount: squad.playerCount,
        notes: [...squad.completeness.notes],
      },
      source: {
        ...squad.source,
        notes: [...squad.source.notes],
      },
      players: squad.players.map((player) => ({
        name: player.name,
        position: player.position,
        ...(player.shirtNumber !== undefined ? { shirtNumber: player.shirtNumber } : {}),
        ...(player.club !== undefined ? { club: player.club } : {}),
        source: {
          ...player.source,
          notes: [...player.source.notes],
        },
      })),
    })),
  };
}

async function getSquadsData() {
  if (!apiFootballSquadsProvider) {
    return formatSquadsData(WC2026_SQUADS.squads, getLocalSquadsProvenance());
  }

  const snapshot = await apiFootballSquadsProvider.read();
  return formatSquadsData(snapshot.squads, snapshot.provenance);
}

function sendOracleSuccess<TData>(res: Response, data: TData) {
  return sendApiSuccess(res, data, getOracleResponseMeta());
}

export async function loadBestModelConfigOverrides(
  configPath?: string | URL
): Promise<Partial<ModelConfig>> {
  const raw = await readOptionalBestModelConfig(configPath);

  if (!raw) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Best model config JSON is malformed: ${getErrorMessage(error)}`);
  }

  return parseBestModelConfigOverrides(parsed);
}

async function readOptionalBestModelConfig(configPath?: string | URL): Promise<string | null> {
  const candidates = configPath
    ? [configPath]
    : [SOURCE_BEST_MODEL_CONFIG_URL, REPO_SOURCE_BEST_MODEL_CONFIG_URL, BUNDLED_BEST_MODEL_CONFIG_URL];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw new Error(
        `Best model config could not be read from ${formatModelConfigPath(candidate)}: ${getErrorMessage(error)}`
      );
    }
  }

  return null;
}

function parseBestModelConfigOverrides(input: unknown): Partial<ModelConfig> {
  if (!isRecord(input)) {
    throw new Error("Best model config must be a JSON object");
  }

  const modelConfig = "modelConfig" in input ? input.modelConfig : input;

  if (!isRecord(modelConfig)) {
    throw new Error("Best model config modelConfig must be a JSON object");
  }

  const overrides: Partial<ModelConfig> = {};
  const mutableOverrides = overrides as UnknownRecord;

  for (const [key, value] of Object.entries(modelConfig)) {
    if (!(key in DEFAULT_MODEL_CONFIG)) {
      throw new Error(`Unknown model config key: ${key}`);
    }

    const configKey = key as keyof ModelConfig;
    const defaultValue = DEFAULT_MODEL_CONFIG[configKey];

    if (configKey === "variant") {
      if (typeof value !== "string" || !(MODEL_VARIANTS as readonly string[]).includes(value)) {
        throw new Error(`variant must be one of: ${MODEL_VARIANTS.join(", ")}`);
      }

      mutableOverrides[configKey] = value;
      continue;
    }

    if (typeof defaultValue === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${key} must be a finite number`);
      }

      mutableOverrides[configKey] = value;
      continue;
    }

    if (typeof defaultValue === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`${key} must be a boolean`);
      }

      mutableOverrides[configKey] = value;
      continue;
    }

    throw new Error(`Unsupported model config key: ${key}`);
  }

  return overrides;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatModelConfigPath(configPath: string | URL): string {
  return typeof configPath === "string" ? configPath : configPath.pathname;
}

export function resetOracleForTests(): void {
  matchContextService.clear();
  Object.assign(cache, createInitialCache());
  liveDataProvider = null;
  apiFootballSquadsProvider = null;
  matchContextService = createMatchContextService();
}

export function setSimulationRunnerForTests(
  runner: SimulationRunner,
): () => void {
  const previousRunner = simulationRunner;
  simulationRunner = runner;

  return () => {
    simulationRunner = previousRunner;
  };
}

export function setSimulationWorkerOptionsForTests(
  overrides: Partial<SimulationWorkerOptions>,
): () => void {
  const previousOptions = cloneSimulationWorkerOptions(simulationWorkerOptions);
  simulationWorkerOptions = {
    ...simulationWorkerOptions,
    ...overrides,
  };

  return () => {
    simulationWorkerOptions = previousOptions;
  };
}

export function setMatchContextServiceForTests(
  service: MatchContextService,
): () => void {
  const previousService = matchContextService;
  matchContextService = service;

  return () => {
    matchContextService.clear();
    matchContextService = previousService;
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
  const { apiFootball, bestModelConfigPath, liveData, ...datasetOptions } = options;

  cache.ready = false;
  cache.loadingError = null;
  configureLiveData(liveData);
  configureApiFootballSquads(apiFootball);

  try {
    const modelConfigOverrides = await loadBestModelConfigOverrides(bestModelConfigPath);
    const {
      ratings: allRatings,
      teamMetrics,
      matchCount,
      fixtureMatches,
      dataset,
      modelConfig,
    } = await computeEloRatings({
      ...datasetOptions,
      modelConfigOverrides,
    });
    const wcRatings = getWCTeamRatings(allRatings);
    cache.matchCount = matchCount;
    cache.ratings = wcRatings;
    cache.teamMetrics = teamMetrics;
    cache.modelConfig = modelConfig;
    cache.fixtureMatches = fixtureMatches;
    cache.dataset = dataset;

    await refreshLiveDataIfNeeded({ force: true, scheduleRecalculation: false });
    await recalculateCachedSimulation();
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
  const liveData = getLiveDataStatus();

  return sendOracleSuccess(res, {
    state,
    ready: cache.ready,
    matchesLoaded: cache.matchCount,
    teamsRated: Object.keys(cache.ratings).length,
    simulationsRun: cache.ready ? NUM_SIMULATIONS : 0,
    simulationSeed: cache.simulationSeed,
    liveMatchesRecorded: cache.playedMatches.length,
    liveDataProvider: liveData.provider,
    liveDataMatchesLoaded: cache.liveData.matches.length,
    liveDataLastSyncedAt: liveData.loadedAt,
    liveDataError: liveData.error,
    liveData,
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
  const liveData = getLiveDataStatus();

  return sendOracleSuccess(res, {
    playedMatches: getMergedPlayedMatches(),
    source: {
      provider: liveData.provider,
      lastSyncedAt: liveData.loadedAt,
      error: liveData.error,
      metadata: liveData,
    },
  });
});

router.get("/oracle/match-context", async (req, res) => {
  const parsed = parseBody<MatchTeams>(matchContextQuerySchema, req.query);

  if (!parsed.success) {
    return sendValidationError(res, parsed.issues);
  }

  const fixture = findMatchContextFixture(parsed.data.homeTeam, parsed.data.awayTeam);

  if (!fixture) {
    return sendApiError(res, 404, {
      code: "fixture_not_found",
      message: `No scheduled fixture found for ${parsed.data.homeTeam} vs ${parsed.data.awayTeam}`,
    });
  }

  const context = await matchContextService.getMatchContext(fixture);

  return sendOracleSuccess(res, context);
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

router.get("/oracle/squads", async (req, res) => {
  return sendOracleSuccess(res, await getSquadsData());
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
  const parsedExperimentalModifiers = parseOptionalBooleanQueryFlag(
    req.query.experimentalModifiers,
    "experimentalModifiers"
  );

  if (!parsed.success) {
    return sendValidationError(res, parsed.issues);
  }

  if (!parsedExperimentalModifiers.success) {
    return sendValidationError(res, parsedExperimentalModifiers.issues);
  }

  const { homeTeam, awayTeam, neutral = true, isHomeA = false, isHomeB = false } = parsed.data;
  const modelConfig = parsedExperimentalModifiers.data
    ? { ...cache.modelConfig, experimentalModifiersEnabled: true }
    : cache.modelConfig;

  const eloHome = cache.ratings[homeTeam] ?? cache.modelConfig.fallbackRating;
  const eloAway = cache.ratings[awayTeam] ?? cache.modelConfig.fallbackRating;
  const metricsHome = cache.teamMetrics[homeTeam];
  const metricsAway = cache.teamMetrics[awayTeam];

  const { pWinA, pDraw, pWinB, xgA, xgB, mostLikelyScore, modifiers } = matchProbabilities(
    eloHome,
    eloAway,
    undefined,
    metricsHome,
    metricsAway,
    isHomeA,
    isHomeB,
    neutral,
    {},
    modelConfig
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
    experimentalModifiers: modifiers,
  });
});

export default router;
