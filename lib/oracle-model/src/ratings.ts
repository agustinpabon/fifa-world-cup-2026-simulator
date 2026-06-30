import { createModelConfig, type ModelConfig } from "./config.js";
import {
  type EloRatings,
  type HistoricalMatch,
  type RatingMatchRow,
  type RatingTeam,
  type TeamMetrics,
  type TeamStrengthMetrics,
} from "./types.js";

export type { RatingMatchRow };

interface StrengthSample {
  date: string;
  adjustedScored: number;
  adjustedConceded: number;
  adjustedWeight: number;
}

export interface RatingState {
  ratings: ReadonlyMap<string, number>;
  samples: ReadonlyMap<string, readonly StrengthSample[]>;
}

export interface RatingComputationOptions extends Partial<ModelConfig> {
  referenceYear?: number;
}

interface NormalizedRatingOptions {
  config: ModelConfig;
  referenceYear: number;
}

export function createEmptyRatingState(): RatingState {
  return {
    ratings: new Map<string, number>(),
    samples: new Map<string, readonly StrengthSample[]>(),
  };
}

export function trainRatingState(
  matches: readonly HistoricalMatch[],
  options: RatingComputationOptions = {}
): RatingState {
  const normalized = normalizeRatingOptions(options);

  return [...matches].sort(compareMatchesByDate).reduce<RatingState>(
    (state, match) => applyMatchToRatingState(state, match, normalized),
    createEmptyRatingState()
  );
}

export function applyMatchToRatingState(
  state: RatingState,
  match: HistoricalMatch,
  options: RatingComputationOptions | NormalizedRatingOptions = {}
): RatingState {
  const normalized = isNormalizedRatingOptions(options) ? options : normalizeRatingOptions(options);
  const homeRating = getRating(state.ratings, match.homeTeam, normalized.config.initialRating);
  const awayRating = getRating(state.ratings, match.awayTeam, normalized.config.initialRating);
  const effectiveHomeRating = homeRating + (match.neutral ? 0 : normalized.config.homeAdvantageElo);
  const nextSamples = addStrengthSamples(state.samples, match, effectiveHomeRating, awayRating, normalized.config);

  return {
    ratings: applyEloUpdate(state.ratings, match, normalized),
    samples: nextSamples,
  };
}

export function computeRatingsAndTeamMetrics(
  inputRows: readonly HistoricalMatch[],
  teams: readonly RatingTeam[],
  options: RatingComputationOptions = {}
): {
  ratings: EloRatings;
  teamMetrics: Record<string, TeamMetrics>;
} {
  const normalized = normalizeRatingOptions(options);
  const state = trainRatingState(inputRows, normalized);
  const ratings = Object.fromEntries(state.ratings.entries()) as EloRatings;
  const referenceDate = `${normalized.referenceYear}-12-31`;
  const teamMetrics: Record<string, TeamMetrics> = {};

  for (const team of teams) {
    const baseElo = ratings[team.csvName] ?? normalized.config.fallbackRating;
    const elo = Math.round(baseElo);
    const metrics = summarizeStrengthMetrics(state.samples, team.csvName, referenceDate, elo, normalized.config);

    teamMetrics[team.name] = {
      elo,
      attackStrength: Math.round(metrics.attackStrength * 100) / 100,
      defenseStrength: Math.round(metrics.defenseStrength * 100) / 100,
    };
  }

  return { ratings, teamMetrics };
}

export function summarizeStrengthMetrics(
  samples: ReadonlyMap<string, readonly StrengthSample[]>,
  team: string,
  referenceDate: string,
  rating: number,
  configInput: Partial<ModelConfig> = {}
): TeamStrengthMetrics {
  const config = createModelConfig(configInput);
  const recentSamples = (samples.get(team) ?? []).filter((sample) =>
    isWithinMetricWindow(sample.date, referenceDate, config)
  );
  const totals = recentSamples.reduce(
    (sum, sample) => ({
      scored: sum.scored + sample.adjustedScored,
      conceded: sum.conceded + sample.adjustedConceded,
      weight: sum.weight + sample.adjustedWeight,
    }),
    { scored: 0, conceded: 0, weight: 0 }
  );
  const eloFactor = teamStrengthFactor(rating, config);

  if (totals.weight <= 0) {
    return {
      attackStrength: clampStrength(eloFactor, config),
      defenseStrength: clampStrength(1 / eloFactor, config),
    };
  }

  const formBlend = config.maxRecentGoalBlend * (totals.weight / (totals.weight + config.recentMetricPriorWeight));
  const rawAttack = totals.scored / totals.weight / config.goalsPerTeamBaseline;
  const rawDefense = totals.conceded / totals.weight / config.goalsPerTeamBaseline;

  return {
    attackStrength: clampStrength(rawAttack * formBlend + eloFactor * (1 - formBlend), config),
    defenseStrength: clampStrength(rawDefense * formBlend + (1 / eloFactor) * (1 - formBlend), config),
  };
}

export function estimateDrawRate(matches: readonly HistoricalMatch[]): number {
  const draws = matches.filter((match) => match.homeScore === match.awayScore).length;
  return (draws + 1) / (matches.length + 3);
}

export function getRating(
  ratings: ReadonlyMap<string, number>,
  team: string,
  fallbackRating: number
): number {
  return ratings.get(team) ?? fallbackRating;
}

export function expectedEloScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function competitionMetricWeight(tournament: string): number {
  return kFactor(tournament) / 40;
}

export function kFactor(tournament: string): number {
  const value = tournament.toLowerCase();
  if (value.includes("fifa world cup") && !value.includes("qualif")) return 60;
  if (
    value.includes("copa america") ||
    value.includes("uefa euro") ||
    value.includes("africa cup") ||
    value.includes("afc asian cup") ||
    value.includes("gold cup") ||
    value.includes("concacaf nations")
  ) {
    return 50;
  }
  if (value.includes("qualif") || value.includes("qualification")) return 40;
  if (value.includes("nations league") || value.includes("confederation")) return 35;
  return 20;
}

export function teamStrengthFactor(rating: number, configInput: Partial<ModelConfig> = {}): number {
  const config = createModelConfig(configInput);
  return Math.pow(10, (rating - config.ratingCenter) / config.metricEloScale);
}

export function clampStrength(value: number, configInput: Partial<ModelConfig> = {}): number {
  const config = createModelConfig(configInput);
  return Math.min(config.strengthMax, Math.max(config.strengthMin, value));
}

export function compareMatchesByDate(a: HistoricalMatch, b: HistoricalMatch): number {
  const dateComparison = a.date.localeCompare(b.date);
  if (dateComparison !== 0) return dateComparison;

  const homeComparison = a.homeTeam.localeCompare(b.homeTeam);
  if (homeComparison !== 0) return homeComparison;

  return a.awayTeam.localeCompare(b.awayTeam);
}

function applyEloUpdate(
  ratings: ReadonlyMap<string, number>,
  match: HistoricalMatch,
  options: NormalizedRatingOptions
): ReadonlyMap<string, number> {
  const homeRating = getRating(ratings, match.homeTeam, options.config.initialRating);
  const awayRating = getRating(ratings, match.awayTeam, options.config.initialRating);
  const effectiveHomeRating = homeRating + (match.neutral ? 0 : options.config.homeAdvantageElo);
  const expectedHome = expectedEloScore(effectiveHomeRating, awayRating);
  const actualHome = actualHomeScore(match);
  const multiplier = goalDifferenceMultiplier(Math.abs(match.homeScore - match.awayScore));
  const delta =
    kFactor(match.tournament) *
    recencyWeight(match.date, options.referenceYear) *
    multiplier *
    (actualHome - expectedHome);
  const next = new Map(ratings);

  next.set(match.homeTeam, homeRating + delta);
  next.set(match.awayTeam, awayRating - delta);

  return next;
}

function addStrengthSamples(
  samples: ReadonlyMap<string, readonly StrengthSample[]>,
  match: HistoricalMatch,
  effectiveHomeRating: number,
  awayRating: number,
  config: ModelConfig
): ReadonlyMap<string, readonly StrengthSample[]> {
  const adjustedWeight = competitionMetricWeight(match.tournament);
  const homeOpponentFactor = teamStrengthFactor(awayRating, config);
  const awayOpponentFactor = teamStrengthFactor(effectiveHomeRating, config);
  const next = new Map(samples);

  next.set(match.homeTeam, [
    ...(next.get(match.homeTeam) ?? []),
    {
      date: match.date,
      adjustedScored: match.homeScore * homeOpponentFactor * adjustedWeight,
      adjustedConceded: (match.awayScore / homeOpponentFactor) * adjustedWeight,
      adjustedWeight,
    },
  ]);
  next.set(match.awayTeam, [
    ...(next.get(match.awayTeam) ?? []),
    {
      date: match.date,
      adjustedScored: match.awayScore * awayOpponentFactor * adjustedWeight,
      adjustedConceded: (match.homeScore / awayOpponentFactor) * adjustedWeight,
      adjustedWeight,
    },
  ]);

  return next;
}

function isWithinMetricWindow(sampleDate: string, referenceDate: string, config: ModelConfig): boolean {
  const sampleYear = Number.parseInt(sampleDate.slice(0, 4), 10);
  const referenceYear = Number.parseInt(referenceDate.slice(0, 4), 10);
  const yearsAgo = referenceYear - sampleYear;

  return Number.isFinite(sampleYear) && Number.isFinite(referenceYear)
    ? yearsAgo >= 0 && yearsAgo <= config.recentMetricWindowYears
    : false;
}

function recencyWeight(date: string, referenceYear: number): number {
  const matchYear = Number.parseInt(date.substring(0, 4), 10) || referenceYear;
  const yearsAgo = Math.max(0, referenceYear - matchYear);

  return Math.max(0.05, Math.exp(-0.055 * yearsAgo));
}

function actualHomeScore(match: HistoricalMatch): number {
  if (match.homeScore > match.awayScore) return 1;
  if (match.awayScore > match.homeScore) return 0;
  return 0.5;
}

function goalDifferenceMultiplier(goalDifference: number): number {
  if (goalDifference <= 1) return 1;
  if (goalDifference === 2) return 1.5;
  return (3 + (goalDifference - 2) / 2) / 4;
}

function normalizeRatingOptions(options: RatingComputationOptions = {}): NormalizedRatingOptions {
  return {
    config: createModelConfig(options),
    referenceYear: options.referenceYear ?? new Date().getFullYear(),
  };
}

function isNormalizedRatingOptions(options: RatingComputationOptions | NormalizedRatingOptions): options is NormalizedRatingOptions {
  return "config" in options && "referenceYear" in options;
}
