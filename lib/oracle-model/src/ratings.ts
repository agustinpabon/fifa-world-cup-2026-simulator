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

interface IsoDateParts {
  year: number;
  month: number;
  day: number;
  timestamp: number;
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
  assertValidRecentMetricHalfLife(config);

  const totals = (samples.get(team) ?? []).reduce(
    (sum, sample) => {
      const decayWeight = recentMetricDecayWeight(sample.date, referenceDate, config);

      return {
        scored: sum.scored + sample.adjustedScored * decayWeight,
        conceded: sum.conceded + sample.adjustedConceded * decayWeight,
        weight: sum.weight + sample.adjustedWeight * decayWeight,
      };
    },
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
  const multiplier = marginOfVictoryEloMultiplier(match, effectiveHomeRating, awayRating, options.config);
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

function assertValidRecentMetricHalfLife(config: ModelConfig): void {
  if (!Number.isFinite(config.recentMetricHalfLifeYears) || config.recentMetricHalfLifeYears <= 0) {
    throw new Error("recentMetricHalfLifeYears must be positive");
  }
}

function recentMetricDecayWeight(sampleDate: string, referenceDate: string, config: ModelConfig): number {
  const yearsAgo = elapsedYearsBetweenIsoDates(sampleDate, referenceDate);

  if (yearsAgo === null || yearsAgo < 0 || yearsAgo > config.recentMetricWindowYears) {
    return 0;
  }

  return Math.exp((-Math.LN2 * yearsAgo) / config.recentMetricHalfLifeYears);
}

function elapsedYearsBetweenIsoDates(startDate: string, endDate: string): number | null {
  const start = parseIsoDateParts(startDate);
  const end = parseIsoDateParts(endDate);

  if (!start || !end) {
    return null;
  }

  if (end.timestamp < start.timestamp) {
    return -calendarElapsedYears(end, start);
  }

  return calendarElapsedYears(start, end);
}

function calendarElapsedYears(start: IsoDateParts, end: IsoDateParts): number {
  let wholeYears = end.year - start.year;
  const anniversaryInEndYear = Date.UTC(end.year, start.month - 1, start.day);

  if (end.timestamp < anniversaryInEndYear) {
    wholeYears -= 1;
  }

  const lastAnniversary = Date.UTC(start.year + wholeYears, start.month - 1, start.day);
  const nextAnniversary = Date.UTC(start.year + wholeYears + 1, start.month - 1, start.day);

  return wholeYears + (end.timestamp - lastAnniversary) / (nextAnniversary - lastAnniversary);
}

function parseIsoDateParts(value: string): IsoDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, timestamp };
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

function marginOfVictoryEloMultiplier(
  match: HistoricalMatch,
  effectiveHomeRating: number,
  awayRating: number,
  config: ModelConfig
): number {
  if (!config.useMarginOfVictoryElo) return 1;

  const goalDifference = Math.abs(match.homeScore - match.awayScore);
  if (goalDifference === 0) return 1;

  if (
    !Number.isFinite(config.marginOfVictoryEloScalingConstant) ||
    config.marginOfVictoryEloScalingConstant <= 0
  ) {
    throw new Error("marginOfVictoryEloScalingConstant must be positive");
  }

  const winnerEloDiff =
    match.homeScore > match.awayScore ? effectiveHomeRating - awayRating : awayRating - effectiveHomeRating;
  const denominator = Math.max(1, config.marginOfVictoryEloScalingConstant + winnerEloDiff);

  return Math.log(goalDifference + 1) * (config.marginOfVictoryEloScalingConstant / denominator);
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
