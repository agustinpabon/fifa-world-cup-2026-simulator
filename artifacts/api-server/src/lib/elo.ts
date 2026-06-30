import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ACTIVE_MODEL_VARIANT,
  DEFAULT_MODEL_CONFIG,
  computeRatingsAndTeamMetrics,
  createModelConfig,
  estimateDrawRate,
  parseResultsCsv,
  type EloRatings,
  type ModelConfig,
  type RatingMatchRow,
  type TeamMetrics,
} from "@workspace/oracle-model";
import { WC2026_FIXTURES, WC2026_TEAMS, type WCFixture } from "./worldcup2026.js";
import { logger } from "./logger.js";

export {
  ACTIVE_MODEL_VARIANT,
  DEFAULT_MODEL_CONFIG,
  competitionMetricWeight,
  computeRatingsAndTeamMetrics,
  type EloRatings,
  type ModelConfig,
  type RatingMatchRow,
  type RatingTeam,
  type TeamMetrics,
} from "@workspace/oracle-model";

export interface PlayedMatch {
  matchNumber?: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  stage?: string;
  source?: "fixture" | "official" | "espn" | "custom";
  sourceId?: string;
  date?: string;
  kickoffTimeEt?: string;
  status?: "scheduled" | "live" | "finished";
  statusDetail?: string;
  group?: string;
  venue?: string;
  region?: string;
  winnerTeam?: string;
}

const CSV_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
const SNAPSHOT_FILENAME = "international-results.snapshot.csv";
const SOURCE_SNAPSHOT_URL = new URL(`../data/${SNAPSHOT_FILENAME}`, import.meta.url);
const BUNDLED_SNAPSHOT_URL = new URL(`./data/${SNAPSHOT_FILENAME}`, import.meta.url);
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_FETCH_ATTEMPTS = 2;

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export type HistoricalDatasetSource = "remote" | "snapshot";

export interface HistoricalDatasetMetadata {
  source: HistoricalDatasetSource;
  date: string;
  hash: string;
  loadedAt: string;
  remoteUrl?: string;
  fallbackReason?: string;
}

export interface HistoricalDataset {
  rows: RatingMatchRow[];
  metadata: HistoricalDatasetMetadata;
}

export interface LoadHistoricalDatasetOptions {
  fetchImpl?: FetchLike;
  maxAttempts?: number;
  remoteUrl?: string;
  snapshotPath?: string | URL;
  timeoutMs?: number;
}

export class HistoricalDataLoadError extends Error {
  readonly code = "HISTORICAL_DATA_LOAD_FAILED";
  readonly remoteError?: unknown;
  readonly snapshotError?: unknown;

  constructor(message: string, details: { remoteError?: unknown; snapshotError?: unknown } = {}) {
    super(message);
    this.name = "HistoricalDataLoadError";
    this.remoteError = details.remoteError;
    this.snapshotError = details.snapshotError;
  }
}

export async function loadHistoricalDataset(
  options: LoadHistoricalDatasetOptions = {}
): Promise<HistoricalDataset> {
  const remoteUrl = options.remoteUrl ?? CSV_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(0, Math.trunc(options.maxAttempts ?? DEFAULT_MAX_FETCH_ATTEMPTS));
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS));
  let remoteError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await fetchCsvWithTimeout(fetchImpl, remoteUrl, timeoutMs);
      return buildHistoricalDataset(raw, {
        source: "remote",
        remoteUrl,
      });
    } catch (error) {
      remoteError = error;
      logger.warn(
        { attempt, maxAttempts, error: getErrorMessage(error) },
        "Historical CSV remote fetch attempt failed"
      );
    }
  }

  try {
    const raw = await readSnapshotCsv(options.snapshotPath);
    const fallbackReason = remoteError
      ? getErrorMessage(remoteError)
      : "Remote historical CSV fetch skipped";

    return buildHistoricalDataset(raw, {
      source: "snapshot",
      fallbackReason,
    });
  } catch (snapshotError) {
    throw new HistoricalDataLoadError(
      "Historical match dataset could not be loaded from remote source or local snapshot.",
      { remoteError, snapshotError }
    );
  }
}

async function fetchCsvWithTimeout(
  fetchImpl: FetchLike,
  remoteUrl: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(remoteUrl, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Remote CSV responded with HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Remote CSV fetch timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readSnapshotCsv(snapshotPath?: string | URL): Promise<string> {
  const candidates = snapshotPath
    ? [snapshotPath]
    : [SOURCE_SNAPSHOT_URL, BUNDLED_SNAPSHOT_URL];
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Local historical CSV snapshot could not be read: ${getErrorMessage(lastError)}`);
}

function buildHistoricalDataset(
  raw: string,
  metadata: Pick<HistoricalDatasetMetadata, "source"> &
    Partial<Pick<HistoricalDatasetMetadata, "fallbackReason" | "remoteUrl">>
): HistoricalDataset {
  const rows = parseResultsCsv(raw);

  if (rows.length === 0) {
    throw new Error("Historical CSV contained no completed matches");
  }

  return {
    rows,
    metadata: {
      source: metadata.source,
      date: getLatestMatchDate(rows),
      hash: createHash("sha256").update(raw).digest("hex"),
      loadedAt: new Date().toISOString(),
      remoteUrl: metadata.remoteUrl,
      fallbackReason: metadata.fallbackReason,
    },
  };
}

function getLatestMatchDate(rows: readonly RatingMatchRow[]): string {
  return rows.reduce((latest, row) => (row.date > latest ? row.date : latest), rows[0]?.date ?? "");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function computeEloRatings(options: LoadHistoricalDatasetOptions = {}): Promise<{
  ratings: EloRatings;
  teamMetrics: Record<string, TeamMetrics>;
  matchCount: number;
  fixtureMatches: PlayedMatch[];
  dataset: HistoricalDatasetMetadata;
  modelConfig: ModelConfig;
}> {
  logger.info("Loading international results CSV...");

  const dataset = await loadHistoricalDataset(options);
  const rows = dataset.rows;
  const modelConfig = createModelConfig({
    variant: ACTIVE_MODEL_VARIANT,
    drawRate: estimateDrawRate(rows),
  });

  logger.info(
    {
      matchCount: rows.length,
      datasetDate: dataset.metadata.date,
      datasetSource: dataset.metadata.source,
      datasetHash: dataset.metadata.hash,
      activeModel: modelConfig.variant,
    },
    "Parsed historical CSV rows"
  );
  const { ratings, teamMetrics } = computeRatingsAndTeamMetrics(rows, WC2026_TEAMS, modelConfig);

  const fixtureMatches = buildFixtureMatches(WC2026_FIXTURES);

  return {
    ratings,
    teamMetrics,
    matchCount: rows.length,
    fixtureMatches,
    dataset: dataset.metadata,
    modelConfig,
  };
}

export function buildFixtureMatches(fixtures: WCFixture[]): PlayedMatch[] {
  return fixtures.map((fixture) => ({
    matchNumber: fixture.matchNumber,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeScore: -1,
    awayScore: -1,
    stage: "Group Stage",
    source: "fixture",
    sourceId: fixture.sourceId,
    date: fixture.date,
    kickoffTimeEt: fixture.kickoffTimeEt,
    status: "scheduled",
    group: fixture.group,
    venue: fixture.venue,
    region: fixture.region,
  }));
}

export const HOST_TEAMS = new Set(["USA", "Mexico", "Canada"]);
export const HOST_BOOST = DEFAULT_MODEL_CONFIG.hostBoost;

export function getWCTeamRatings(allRatings: EloRatings): EloRatings {
  const result: EloRatings = {};
  for (const team of WC2026_TEAMS) {
    const baseElo = allRatings[team.csvName] ?? DEFAULT_MODEL_CONFIG.fallbackRating;
    result[team.name] = Math.round(baseElo);
  }
  return result;
}
