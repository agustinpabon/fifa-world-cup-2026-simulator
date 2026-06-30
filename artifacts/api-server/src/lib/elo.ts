import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { WC2026_FIXTURES, WC2026_TEAMS, type WCFixture } from "./worldcup2026.js";
import { logger } from "./logger.js";

export interface PlayedMatch {
  matchNumber?: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  stage?: string;
  source?: "fixture" | "official" | "custom";
  sourceId?: string;
  date?: string;
  kickoffTimeEt?: string;
  status?: "scheduled" | "live" | "finished";
  group?: string;
  venue?: string;
  region?: string;
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

export interface EloRatings {
  [teamName: string]: number;
}

export interface TeamMetrics {
  elo: number;
  attackStrength: number;
  defenseStrength: number;
}

export interface RatingMatchRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  tournament: string;
  neutral: boolean;
}

interface RatingTeam {
  name: string;
  csvName: string;
}

interface RatingComputationOptions {
  referenceYear?: number;
  initialRating?: number;
  fallbackElo?: number;
}

interface MetricAccumulator {
  adjustedScored: number;
  adjustedConceded: number;
  weight: number;
}

const DEFAULT_INITIAL_RATING = 1000;
const FALLBACK_TEAM_ELO = 1500;
const HOME_ADVANTAGE_ELO = 75;
const RECENT_METRIC_WINDOW_YEARS = 8;
const GOALS_PER_TEAM_BASELINE = 1.35;
const MAX_RECENT_GOAL_BLEND = 0.35;
const RECENT_METRIC_PRIOR_WEIGHT = 12;
const METRIC_ELO_SCALE = 600;

function kFactor(tournament: string): number {
  const t = tournament.toLowerCase();
  if (t.includes("fifa world cup") && !t.includes("qualif")) return 60;
  if (t.includes("copa america") || t.includes("uefa euro") || t.includes("africa cup") || t.includes("afc asian cup") || t.includes("gold cup") || t.includes("concacaf nations")) return 50;
  if (t.includes("qualif") || t.includes("qualification")) return 40;
  if (t.includes("nations league") || t.includes("confederation")) return 35;
  return 20; // Friendly
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function parseCSV(raw: string): RatingMatchRow[] {
  const lines = raw.split("\n");
  const rows: RatingMatchRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",");
    if (parts.length < 9) continue;

    const date = parts[0];
    const homeTeam = parts[1];
    const awayTeam = parts[2];
    const homeScore = parseInt(parts[3], 10);
    const awayScore = parseInt(parts[4], 10);
    const tournament = parts[5];
    const neutral = parts[8]?.trim().toUpperCase() === "TRUE";

    if (isNaN(homeScore) || isNaN(awayScore)) {
      continue;
    }

    rows.push({ date, homeTeam, awayTeam, homeScore, awayScore, tournament, neutral });
  }

  return rows;
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
  const rows = parseCSV(raw);

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

export function competitionMetricWeight(tournament: string): number {
  // Reuse the existing Elo importance ladder so this is documented and not an extra tuned parameter.
  return kFactor(tournament) / 40;
}

export function computeRatingsAndTeamMetrics(
  inputRows: readonly RatingMatchRow[],
  teams: readonly RatingTeam[] = WC2026_TEAMS,
  options: RatingComputationOptions = {}
): {
  ratings: EloRatings;
  teamMetrics: Record<string, TeamMetrics>;
} {
  const referenceYear = options.referenceYear ?? new Date().getFullYear();
  const initialRating = options.initialRating ?? DEFAULT_INITIAL_RATING;
  const fallbackElo = options.fallbackElo ?? FALLBACK_TEAM_ELO;
  const rows = [...inputRows].sort((a, b) => a.date.localeCompare(b.date));
  const ratings: EloRatings = {};
  const metricAccumulators: Record<string, MetricAccumulator> = {};

  function getRating(team: string): number {
    if (!(team in ratings)) ratings[team] = initialRating;
    return ratings[team];
  }

  for (const row of rows) {
    const { date, homeTeam, awayTeam, homeScore, awayScore, tournament, neutral } = row;

    const homeAdv = neutral ? 0 : HOME_ADVANTAGE_ELO;
    const rA = getRating(homeTeam) + homeAdv;
    const rB = getRating(awayTeam);

    const expectedA = expectedScore(rA, rB);
    const expectedB = 1 - expectedA;

    let actualA: number;
    let actualB: number;

    if (homeScore > awayScore) {
      actualA = 1;
      actualB = 0;
    } else if (homeScore < awayScore) {
      actualA = 0;
      actualB = 1;
    } else {
      actualA = 0.5;
      actualB = 0.5;
    }

    const matchYear = parseInt(date.substring(0, 4), 10) || referenceYear;
    const yearsAgo = Math.max(0, referenceYear - matchYear);

    if (yearsAgo <= RECENT_METRIC_WINDOW_YEARS) {
      metricAccumulators[homeTeam] = addMetricContribution(
        metricAccumulators[homeTeam],
        homeScore,
        awayScore,
        rB,
        tournament
      );
      metricAccumulators[awayTeam] = addMetricContribution(
        metricAccumulators[awayTeam],
        awayScore,
        homeScore,
        rA,
        tournament
      );
    }

    // Exponential time-decay factor (recalibrated half-life ~10-12 years, min floor 0.05)
    const recencyWeight = Math.max(0.05, Math.exp(-0.055 * yearsAgo));

    const K = kFactor(tournament) * recencyWeight;
    const goalDiff = Math.abs(homeScore - awayScore);
    // Goal difference multiplier (FIFA World Football Elo standard)
    const gdMult = goalDiff <= 1 ? 1 : goalDiff === 2 ? 1.5 : (3 + (goalDiff - 2) / 2) / 4;

    const deltaA = K * gdMult * (actualA - expectedA);
    const deltaB = K * gdMult * (actualB - expectedB);

    ratings[homeTeam] = (ratings[homeTeam] ?? initialRating) + deltaA;
    ratings[awayTeam] = (ratings[awayTeam] ?? initialRating) + deltaB;
  }

  const teamMetrics: Record<string, TeamMetrics> = {};
  for (const team of teams) {
    const baseElo = ratings[team.csvName] ?? fallbackElo;
    const elo = Math.round(baseElo);
    const eloFactor = teamStrengthFactor(elo);
    const accumulator = metricAccumulators[team.csvName];
    const formBlend = accumulator
      ? MAX_RECENT_GOAL_BLEND * (accumulator.weight / (accumulator.weight + RECENT_METRIC_PRIOR_WEIGHT))
      : 0;

    const attackForm =
      accumulator && accumulator.weight > 0
        ? accumulator.adjustedScored / accumulator.weight / GOALS_PER_TEAM_BASELINE
        : eloFactor;
    const defenseForm =
      accumulator && accumulator.weight > 0
        ? accumulator.adjustedConceded / accumulator.weight / GOALS_PER_TEAM_BASELINE
        : 1 / eloFactor;

    const atk = clampStrength(attackForm * formBlend + eloFactor * (1 - formBlend));
    const def = clampStrength(defenseForm * formBlend + (1 / eloFactor) * (1 - formBlend));

    teamMetrics[team.name] = {
      elo,
      attackStrength: Math.round(atk * 100) / 100,
      defenseStrength: Math.round(def * 100) / 100,
    };
  }

  return { ratings, teamMetrics };
}

function addMetricContribution(
  accumulator: MetricAccumulator | undefined,
  goalsScored: number,
  goalsConceded: number,
  effectiveOpponentRating: number,
  tournament: string
): MetricAccumulator {
  const weight = competitionMetricWeight(tournament);
  const opponentFactor = teamStrengthFactor(effectiveOpponentRating);
  const current = accumulator ?? { adjustedScored: 0, adjustedConceded: 0, weight: 0 };

  return {
    adjustedScored: current.adjustedScored + goalsScored * opponentFactor * weight,
    adjustedConceded: current.adjustedConceded + (goalsConceded / opponentFactor) * weight,
    weight: current.weight + weight,
  };
}

function teamStrengthFactor(elo: number): number {
  return Math.pow(10, (elo - FALLBACK_TEAM_ELO) / METRIC_ELO_SCALE);
}

function clampStrength(value: number): number {
  return Math.min(1.5, Math.max(0.6, value));
}

export async function computeEloRatings(options: LoadHistoricalDatasetOptions = {}): Promise<{
  ratings: EloRatings;
  teamMetrics: Record<string, TeamMetrics>;
  matchCount: number;
  fixtureMatches: PlayedMatch[];
  dataset: HistoricalDatasetMetadata;
}> {
  logger.info("Loading international results CSV...");

  const dataset = await loadHistoricalDataset(options);
  const rows = dataset.rows;
  logger.info(
    {
      matchCount: rows.length,
      datasetDate: dataset.metadata.date,
      datasetSource: dataset.metadata.source,
      datasetHash: dataset.metadata.hash,
    },
    "Parsed historical CSV rows"
  );
  const { ratings, teamMetrics } = computeRatingsAndTeamMetrics(rows);

  const fixtureMatches = buildFixtureMatches(WC2026_FIXTURES);

  return { ratings, teamMetrics, matchCount: rows.length, fixtureMatches, dataset: dataset.metadata };
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
export const HOST_BOOST = 50; // Elo boost for World Cup 2026 host nations playing at home

export function getWCTeamRatings(allRatings: EloRatings): EloRatings {
  const result: EloRatings = {};
  for (const team of WC2026_TEAMS) {
    const baseElo = allRatings[team.csvName] ?? 1500;
    result[team.name] = Math.round(baseElo);
  }
  return result;
}
