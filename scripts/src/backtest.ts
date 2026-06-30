import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OUTCOMES = ["home", "draw", "away"] as const;

export type Outcome = (typeof OUTCOMES)[number];

export type OutcomeProbabilities = Record<Outcome, number>;

export interface HistoricalMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  tournament: string;
  neutral: boolean;
}

export interface BacktestOptions {
  testStart: string;
  testEnd: string;
  initialRating?: number;
  homeAdvantageElo?: number;
  maxGoals?: number;
  dixonColesRho?: number;
  sampleForecastLimit?: number;
}

export interface BacktestSplit {
  train: HistoricalMatch[];
  test: HistoricalMatch[];
  excluded: number;
}

export interface ScoredForecast {
  probabilities: OutcomeProbabilities;
  actual: Outcome;
}

export interface CalibrationBucket {
  bucket: string;
  count: number;
  meanConfidence: number;
  accuracy: number;
  calibrationError: number;
}

export interface MetricSummary {
  matches: number;
  brierScore: number;
  logLoss: number;
  accuracy: number;
  calibrationBuckets: CalibrationBucket[];
}

export interface ForecastSample {
  date: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  actual: Outcome;
  probabilities: {
    model: OutcomeProbabilities;
    legacyStrengthModel: OutcomeProbabilities;
    eloBaseline: OutcomeProbabilities;
    uniformBaseline: OutcomeProbabilities;
  };
}

export interface BacktestReport {
  reportVersion: 2;
  methodology: string;
  config: Required<BacktestOptions> & {
    rollingUpdate: true;
  };
  dataset: {
    totalMatches: number;
    trainMatches: number;
    testMatches: number;
    excludedMatches: number;
    trainDateRange: DateRangeSummary;
    testDateRange: DateRangeSummary;
  };
  models: {
    model: string;
    legacyStrengthModel: string;
    eloBaseline: string;
    uniformBaseline: string;
  };
  metrics: {
    model: MetricSummary;
    legacyStrengthModel: MetricSummary;
    eloBaseline: MetricSummary;
    uniformBaseline: MetricSummary;
  };
  sampleForecasts: ForecastSample[];
}

interface DateRangeSummary {
  start: string | null;
  end: string | null;
}

interface RatingUpdateOptions {
  initialRating: number;
  homeAdvantageElo: number;
}

interface NormalizedBacktestOptions extends Required<BacktestOptions> {}

interface CliOptions extends BacktestOptions {
  input?: string;
  sourceUrl: string;
  output: string;
}

interface StrengthMetrics {
  attackStrength: number;
  defenseStrength: number;
}

interface StrengthSample {
  date: string;
  legacyScored: number;
  legacyConceded: number;
  adjustedScored: number;
  adjustedConceded: number;
  adjustedWeight: number;
}

interface RollingModelState {
  ratings: ReadonlyMap<string, number>;
  samples: ReadonlyMap<string, readonly StrengthSample[]>;
}

const DEFAULT_RESULTS_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
const DEFAULT_TEST_START = "2024-01-01";
const DEFAULT_TEST_END = "2024-12-31";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "reports/backtests/latest.json");
const BASE_XG = 1.25;
const ELO_SCALE = 400;
const EPSILON = 1e-15;
const METRIC_WINDOW_YEARS = 8;
const GOALS_PER_TEAM_BASELINE = 1.35;
const MAX_RECENT_GOAL_BLEND = 0.35;
const RECENT_METRIC_PRIOR_WEIGHT = 12;
const METRIC_ELO_SCALE = 600;

const DEFAULT_BACKTEST_OPTIONS: NormalizedBacktestOptions = {
  testStart: DEFAULT_TEST_START,
  testEnd: DEFAULT_TEST_END,
  initialRating: 1000,
  homeAdvantageElo: 75,
  maxGoals: 10,
  dixonColesRho: -0.06,
  sampleForecastLimit: 20,
};

const UNIFORM_PROBABILITIES: OutcomeProbabilities = {
  home: 1 / 3,
  draw: 1 / 3,
  away: 1 / 3,
};

export function parseResultsCsv(raw: string): HistoricalMatch[] {
  const lines = raw.split(/\r?\n/);
  const matches: HistoricalMatch[] = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;

    const parts = parseCsvLine(line);
    if (parts.length < 9) continue;

    const homeScore = Number.parseInt(parts[3] ?? "", 10);
    const awayScore = Number.parseInt(parts[4] ?? "", 10);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    matches.push({
      date: parts[0] ?? "",
      homeTeam: parts[1] ?? "",
      awayTeam: parts[2] ?? "",
      homeScore,
      awayScore,
      tournament: parts[5] ?? "",
      neutral: (parts[8] ?? "").trim().toUpperCase() === "TRUE",
    });
  }

  return matches.filter(
    (match) => isIsoDate(match.date) && match.homeTeam.length > 0 && match.awayTeam.length > 0
  );
}

export function splitMatchesForBacktest(matches: readonly HistoricalMatch[], options: BacktestOptions): BacktestSplit {
  const normalized = normalizeBacktestOptions(options);
  const sortedMatches = [...matches].sort(compareMatchesByDate);
  const train = sortedMatches.filter((match) => match.date < normalized.testStart);
  const test = sortedMatches.filter((match) => match.date >= normalized.testStart && match.date <= normalized.testEnd);

  return {
    train,
    test,
    excluded: sortedMatches.length - train.length - test.length,
  };
}

export function poissonOutcomeProbabilities(
  homeRating: number,
  awayRating: number,
  neutral: boolean,
  options: Partial<Pick<BacktestOptions, "homeAdvantageElo" | "maxGoals" | "dixonColesRho">> = {}
): OutcomeProbabilities {
  return poissonOutcomeProbabilitiesWithStrengths(homeRating, awayRating, neutral, undefined, undefined, options);
}

function poissonOutcomeProbabilitiesWithStrengths(
  homeRating: number,
  awayRating: number,
  neutral: boolean,
  homeMetrics: StrengthMetrics | undefined,
  awayMetrics: StrengthMetrics | undefined,
  options: Partial<Pick<BacktestOptions, "homeAdvantageElo" | "maxGoals" | "dixonColesRho">> = {}
): OutcomeProbabilities {
  const normalized = normalizeBacktestOptions({
    testStart: DEFAULT_TEST_START,
    testEnd: DEFAULT_TEST_END,
    ...options,
  });
  const effectiveHomeRating = homeRating + (neutral ? 0 : normalized.homeAdvantageElo);
  const { homeXg, awayXg } = expectedGoals(effectiveHomeRating, awayRating, homeMetrics, awayMetrics);
  const probabilities: OutcomeProbabilities = { home: 0, draw: 0, away: 0 };

  for (let homeGoals = 0; homeGoals <= normalized.maxGoals; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= normalized.maxGoals; awayGoals++) {
      const adjustment = dixonColesAdjustment(homeGoals, awayGoals, homeXg, awayXg, normalized.dixonColesRho);
      const probability = Math.max(0, poissonPmf(homeGoals, homeXg) * poissonPmf(awayGoals, awayXg) * adjustment);
      probabilities[outcomeForScore(homeGoals, awayGoals)] += probability;
    }
  }

  return normalizeProbabilities(probabilities);
}

export function scoreForecasts(forecasts: readonly ScoredForecast[]): MetricSummary {
  if (forecasts.length === 0) {
    throw new Error("Cannot score an empty forecast set");
  }

  let brierTotal = 0;
  let logLossTotal = 0;
  let correct = 0;
  const buckets = new Map<number, { count: number; confidenceTotal: number; correct: number }>();

  for (const forecast of forecasts) {
    const predicted = predictedOutcome(forecast.probabilities);
    const confidence = forecast.probabilities[predicted];
    const bucketStart = Math.floor(Math.min(confidence, 0.999999999) * 10) / 10;
    const currentBucket = buckets.get(bucketStart) ?? { count: 0, confidenceTotal: 0, correct: 0 };
    const isCorrect = predicted === forecast.actual;

    brierTotal += OUTCOMES.reduce((sum, outcome) => {
      const observed = outcome === forecast.actual ? 1 : 0;
      return sum + (forecast.probabilities[outcome] - observed) ** 2;
    }, 0);
    logLossTotal += -Math.log(Math.max(EPSILON, forecast.probabilities[forecast.actual]));
    correct += isCorrect ? 1 : 0;
    buckets.set(bucketStart, {
      count: currentBucket.count + 1,
      confidenceTotal: currentBucket.confidenceTotal + confidence,
      correct: currentBucket.correct + (isCorrect ? 1 : 0),
    });
  }

  return {
    matches: forecasts.length,
    brierScore: brierTotal / forecasts.length,
    logLoss: logLossTotal / forecasts.length,
    accuracy: correct / forecasts.length,
    calibrationBuckets: [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucketStart, bucket]) => {
        const meanConfidence = bucket.confidenceTotal / bucket.count;
        const accuracy = bucket.correct / bucket.count;

        return {
          bucket: `${bucketStart.toFixed(1)}-${(bucketStart + 0.1).toFixed(1)}`,
          count: bucket.count,
          meanConfidence,
          accuracy,
          calibrationError: accuracy - meanConfidence,
        };
      }),
  };
}

export function runHistoricalBacktest(matches: readonly HistoricalMatch[], options: BacktestOptions): BacktestReport {
  const normalized = normalizeBacktestOptions(options);
  const split = splitMatchesForBacktest(matches, normalized);

  if (split.train.length === 0) {
    throw new Error(`Backtest needs at least one training match before ${normalized.testStart}`);
  }
  if (split.test.length === 0) {
    throw new Error(`Backtest has no test matches from ${normalized.testStart} to ${normalized.testEnd}`);
  }

  let state = trainModelState(split.train, normalized);
  const drawRate = estimateDrawRate(split.train);
  const modelForecasts: ScoredForecast[] = [];
  const legacyStrengthForecasts: ScoredForecast[] = [];
  const eloBaselineForecasts: ScoredForecast[] = [];
  const uniformBaselineForecasts: ScoredForecast[] = [];
  const sampleForecasts: ForecastSample[] = [];

  for (const match of split.test) {
    const homeRating = getRating(state.ratings, match.homeTeam, normalized.initialRating);
    const awayRating = getRating(state.ratings, match.awayTeam, normalized.initialRating);
    const adjustedHomeMetrics = summarizeStrengthMetrics(
      state.samples,
      match.homeTeam,
      match.date,
      homeRating,
      "adjusted"
    );
    const adjustedAwayMetrics = summarizeStrengthMetrics(
      state.samples,
      match.awayTeam,
      match.date,
      awayRating,
      "adjusted"
    );
    const legacyHomeMetrics = summarizeStrengthMetrics(
      state.samples,
      match.homeTeam,
      match.date,
      homeRating,
      "legacy"
    );
    const legacyAwayMetrics = summarizeStrengthMetrics(
      state.samples,
      match.awayTeam,
      match.date,
      awayRating,
      "legacy"
    );
    const actual = outcomeForScore(match.homeScore, match.awayScore);
    const model = poissonOutcomeProbabilitiesWithStrengths(
      homeRating,
      awayRating,
      match.neutral,
      adjustedHomeMetrics,
      adjustedAwayMetrics,
      normalized
    );
    const legacyStrengthModel = poissonOutcomeProbabilitiesWithStrengths(
      homeRating,
      awayRating,
      match.neutral,
      legacyHomeMetrics,
      legacyAwayMetrics,
      normalized
    );
    const eloBaseline = simpleEloBaselineProbabilities(homeRating, awayRating, match.neutral, drawRate, normalized);

    modelForecasts.push({ probabilities: model, actual });
    legacyStrengthForecasts.push({ probabilities: legacyStrengthModel, actual });
    eloBaselineForecasts.push({ probabilities: eloBaseline, actual });
    uniformBaselineForecasts.push({ probabilities: UNIFORM_PROBABILITIES, actual });

    if (sampleForecasts.length < normalized.sampleForecastLimit) {
      sampleForecasts.push({
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        score: `${match.homeScore}-${match.awayScore}`,
        actual,
        probabilities: {
          model,
          legacyStrengthModel,
          eloBaseline,
          uniformBaseline: UNIFORM_PROBABILITIES,
        },
      });
    }

    state = applyMatchToModelState(state, match, normalized);
  }

  return {
    reportVersion: 2,
    methodology:
      "Rolling-origin historical match backtest: train Elo ratings on matches before testStart, score each test match before applying that match result to ratings for later test matches.",
    config: {
      ...normalized,
      rollingUpdate: true,
    },
    dataset: {
      totalMatches: matches.length,
      trainMatches: split.train.length,
      testMatches: split.test.length,
      excludedMatches: split.excluded,
      trainDateRange: summarizeDateRange(split.train),
      testDateRange: summarizeDateRange(split.test),
    },
    models: {
      model:
        "Adjusted strength model: chronological Elo ratings plus recent attack/defense multipliers adjusted by opponent Elo at match time and competition weight, converted to deterministic Dixon-Coles-adjusted Poisson home/draw/away probabilities.",
      legacyStrengthModel:
        "Legacy strength model: chronological Elo ratings plus unadjusted recent average goals scored/conceded, matching the previous attack/defense multiplier approach.",
      eloBaseline:
        "Simple Elo baseline: chronological Elo expected score with a Laplace-smoothed draw prior learned from training matches.",
      uniformBaseline: "Uniform baseline: fixed 1/3 probability for home win, draw, and away win.",
    },
    metrics: {
      model: scoreForecasts(modelForecasts),
      legacyStrengthModel: scoreForecasts(legacyStrengthForecasts),
      eloBaseline: scoreForecasts(eloBaselineForecasts),
      uniformBaseline: scoreForecasts(uniformBaselineForecasts),
    },
    sampleForecasts,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(argv);
  const raw = options.input
    ? await readFile(path.resolve(options.input), "utf8")
    : await fetchText(options.sourceUrl);
  const matches = parseResultsCsv(raw);
  const report = runHistoricalBacktest(matches, toBacktestOptions(options));
  const outputPath = path.resolve(options.output);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  printSummary(report, outputPath);
}

function normalizeBacktestOptions(options: BacktestOptions): NormalizedBacktestOptions {
  const normalized = { ...DEFAULT_BACKTEST_OPTIONS, ...options };

  if (!isIsoDate(normalized.testStart) || !isIsoDate(normalized.testEnd)) {
    throw new Error("testStart and testEnd must be ISO dates in YYYY-MM-DD format");
  }
  if (normalized.testStart > normalized.testEnd) {
    throw new Error(`testStart ${normalized.testStart} must be on or before testEnd ${normalized.testEnd}`);
  }
  if (normalized.maxGoals < 4) {
    throw new Error("maxGoals must be at least 4");
  }
  if (!Number.isInteger(normalized.sampleForecastLimit) || normalized.sampleForecastLimit < 0) {
    throw new Error("sampleForecastLimit must be a non-negative integer");
  }

  return normalized;
}

function toBacktestOptions(options: CliOptions): BacktestOptions {
  return {
    testStart: options.testStart,
    testEnd: options.testEnd,
    initialRating: options.initialRating,
    homeAdvantageElo: options.homeAdvantageElo,
    maxGoals: options.maxGoals,
    dixonColesRho: options.dixonColesRho,
    sampleForecastLimit: options.sampleForecastLimit,
  };
}

function trainModelState(matches: readonly HistoricalMatch[], options: RatingUpdateOptions): RollingModelState {
  return matches.reduce<RollingModelState>(
    (state, match) => applyMatchToModelState(state, match, options),
    { ratings: new Map<string, number>(), samples: new Map<string, readonly StrengthSample[]>() }
  );
}

function applyMatchToModelState(
  state: RollingModelState,
  match: HistoricalMatch,
  options: RatingUpdateOptions
): RollingModelState {
  const homeRating = getRating(state.ratings, match.homeTeam, options.initialRating);
  const awayRating = getRating(state.ratings, match.awayTeam, options.initialRating);
  const effectiveHomeRating = homeRating + (match.neutral ? 0 : options.homeAdvantageElo);
  const nextSamples = addStrengthSamples(state.samples, match, effectiveHomeRating, awayRating);

  return {
    ratings: applyEloUpdate(state.ratings, match, options),
    samples: nextSamples,
  };
}

function addStrengthSamples(
  samples: ReadonlyMap<string, readonly StrengthSample[]>,
  match: HistoricalMatch,
  effectiveHomeRating: number,
  awayRating: number
): ReadonlyMap<string, readonly StrengthSample[]> {
  const adjustedWeight = competitionMetricWeight(match.tournament);
  const homeOpponentFactor = teamStrengthFactor(awayRating);
  const awayOpponentFactor = teamStrengthFactor(effectiveHomeRating);
  const next = new Map(samples);

  next.set(match.homeTeam, [
    ...(next.get(match.homeTeam) ?? []),
    {
      date: match.date,
      legacyScored: match.homeScore,
      legacyConceded: match.awayScore,
      adjustedScored: match.homeScore * homeOpponentFactor * adjustedWeight,
      adjustedConceded: (match.awayScore / homeOpponentFactor) * adjustedWeight,
      adjustedWeight,
    },
  ]);
  next.set(match.awayTeam, [
    ...(next.get(match.awayTeam) ?? []),
    {
      date: match.date,
      legacyScored: match.awayScore,
      legacyConceded: match.homeScore,
      adjustedScored: match.awayScore * awayOpponentFactor * adjustedWeight,
      adjustedConceded: (match.homeScore / awayOpponentFactor) * adjustedWeight,
      adjustedWeight,
    },
  ]);

  return next;
}

function summarizeStrengthMetrics(
  samples: ReadonlyMap<string, readonly StrengthSample[]>,
  team: string,
  referenceDate: string,
  rating: number,
  variant: "adjusted" | "legacy"
): StrengthMetrics {
  const recentSamples = (samples.get(team) ?? []).filter((sample) =>
    isWithinMetricWindow(sample.date, referenceDate)
  );
  const eloFactor = teamStrengthFactor(rating);

  if (variant === "legacy") {
    return summarizeLegacyStrengthMetrics(recentSamples, eloFactor);
  }

  return summarizeAdjustedStrengthMetrics(recentSamples, eloFactor);
}

function summarizeLegacyStrengthMetrics(
  samples: readonly StrengthSample[],
  eloFactor: number
): StrengthMetrics {
  if (samples.length < 5) {
    return {
      attackStrength: clampStrength(eloFactor),
      defenseStrength: clampStrength(1 / eloFactor),
    };
  }

  const totals = samples.reduce(
    (sum, sample) => ({
      scored: sum.scored + sample.legacyScored,
      conceded: sum.conceded + sample.legacyConceded,
    }),
    { scored: 0, conceded: 0 }
  );
  const rawAttack = totals.scored / samples.length / GOALS_PER_TEAM_BASELINE;
  const rawDefense = totals.conceded / samples.length / GOALS_PER_TEAM_BASELINE;

  return {
    attackStrength: clampStrength(rawAttack * MAX_RECENT_GOAL_BLEND + eloFactor * (1 - MAX_RECENT_GOAL_BLEND)),
    defenseStrength: clampStrength(rawDefense * MAX_RECENT_GOAL_BLEND + (1 / eloFactor) * (1 - MAX_RECENT_GOAL_BLEND)),
  };
}

function summarizeAdjustedStrengthMetrics(
  samples: readonly StrengthSample[],
  eloFactor: number
): StrengthMetrics {
  const totals = samples.reduce(
    (sum, sample) => ({
      scored: sum.scored + sample.adjustedScored,
      conceded: sum.conceded + sample.adjustedConceded,
      weight: sum.weight + sample.adjustedWeight,
    }),
    { scored: 0, conceded: 0, weight: 0 }
  );

  if (totals.weight <= 0) {
    return {
      attackStrength: clampStrength(eloFactor),
      defenseStrength: clampStrength(1 / eloFactor),
    };
  }

  const formBlend = MAX_RECENT_GOAL_BLEND * (totals.weight / (totals.weight + RECENT_METRIC_PRIOR_WEIGHT));
  const rawAttack = totals.scored / totals.weight / GOALS_PER_TEAM_BASELINE;
  const rawDefense = totals.conceded / totals.weight / GOALS_PER_TEAM_BASELINE;

  return {
    attackStrength: clampStrength(rawAttack * formBlend + eloFactor * (1 - formBlend)),
    defenseStrength: clampStrength(rawDefense * formBlend + (1 / eloFactor) * (1 - formBlend)),
  };
}

function isWithinMetricWindow(sampleDate: string, referenceDate: string): boolean {
  const sampleYear = Number.parseInt(sampleDate.slice(0, 4), 10);
  const referenceYear = Number.parseInt(referenceDate.slice(0, 4), 10);

  const yearsAgo = referenceYear - sampleYear;

  return Number.isFinite(sampleYear) && Number.isFinite(referenceYear)
    ? yearsAgo >= 0 && yearsAgo <= METRIC_WINDOW_YEARS
    : false;
}

function applyEloUpdate(
  ratings: ReadonlyMap<string, number>,
  match: HistoricalMatch,
  options: RatingUpdateOptions
): ReadonlyMap<string, number> {
  const homeRating = getRating(ratings, match.homeTeam, options.initialRating);
  const awayRating = getRating(ratings, match.awayTeam, options.initialRating);
  const effectiveHomeRating = homeRating + (match.neutral ? 0 : options.homeAdvantageElo);
  const expectedHome = expectedEloScore(effectiveHomeRating, awayRating);
  const actualHome = actualHomeScore(match);
  const multiplier = goalDifferenceMultiplier(Math.abs(match.homeScore - match.awayScore));
  const delta = kFactor(match.tournament) * multiplier * (actualHome - expectedHome);
  const next = new Map(ratings);

  next.set(match.homeTeam, homeRating + delta);
  next.set(match.awayTeam, awayRating - delta);

  return next;
}

function simpleEloBaselineProbabilities(
  homeRating: number,
  awayRating: number,
  neutral: boolean,
  drawRate: number,
  options: RatingUpdateOptions
): OutcomeProbabilities {
  const effectiveHomeRating = homeRating + (neutral ? 0 : options.homeAdvantageElo);
  const expectedHome = expectedEloScore(effectiveHomeRating, awayRating);
  const decisiveRate = 1 - drawRate;

  return normalizeProbabilities({
    home: decisiveRate * expectedHome,
    draw: drawRate,
    away: decisiveRate * (1 - expectedHome),
  });
}

function estimateDrawRate(matches: readonly HistoricalMatch[]): number {
  const draws = matches.filter((match) => match.homeScore === match.awayScore).length;
  return (draws + 1) / (matches.length + OUTCOMES.length);
}

function expectedGoals(
  homeRating: number,
  awayRating: number,
  homeMetrics?: StrengthMetrics,
  awayMetrics?: StrengthMetrics
): { homeXg: number; awayXg: number } {
  const diff = (homeRating - awayRating) / ELO_SCALE;
  const mult = Math.pow(10, diff);
  const ratio = Math.min(Math.max(Math.sqrt(mult), 0.15), 6.5);
  const total = BASE_XG * 2;
  let homeXg = (total * ratio) / (1 + ratio);
  let awayXg = total - homeXg;

  if (homeMetrics && awayMetrics) {
    homeXg *= homeMetrics.attackStrength * awayMetrics.defenseStrength;
    awayXg *= awayMetrics.attackStrength * homeMetrics.defenseStrength;
  }

  return {
    homeXg: Math.max(0.05, homeXg),
    awayXg: Math.max(0.05, awayXg),
  };
}

function poissonPmf(k: number, lambda: number): number {
  let probability = Math.exp(-lambda);

  for (let index = 1; index <= k; index++) {
    probability *= lambda / index;
  }

  return probability;
}

function dixonColesAdjustment(homeGoals: number, awayGoals: number, homeXg: number, awayXg: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeXg * awayXg * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayXg * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeXg * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function normalizeProbabilities(probabilities: OutcomeProbabilities): OutcomeProbabilities {
  const total = OUTCOMES.reduce((sum, outcome) => sum + probabilities[outcome], 0);
  if (total <= 0) {
    throw new Error("Cannot normalize probabilities with non-positive total");
  }

  return {
    home: probabilities.home / total,
    draw: probabilities.draw / total,
    away: probabilities.away / total,
  };
}

function predictedOutcome(probabilities: OutcomeProbabilities): Outcome {
  return OUTCOMES.reduce((best, outcome) =>
    probabilities[outcome] > probabilities[best] ? outcome : best
  );
}

function outcomeForScore(homeScore: number, awayScore: number): Outcome {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

function actualHomeScore(match: HistoricalMatch): number {
  if (match.homeScore > match.awayScore) return 1;
  if (match.awayScore > match.homeScore) return 0;
  return 0.5;
}

function expectedEloScore(homeRating: number, awayRating: number): number {
  return 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
}

function kFactor(tournament: string): number {
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

function competitionMetricWeight(tournament: string): number {
  return kFactor(tournament) / 40;
}

function teamStrengthFactor(rating: number): number {
  return Math.pow(10, (rating - 1500) / METRIC_ELO_SCALE);
}

function clampStrength(value: number): number {
  return Math.min(1.5, Math.max(0.6, value));
}

function goalDifferenceMultiplier(goalDifference: number): number {
  if (goalDifference <= 1) return 1;
  if (goalDifference === 2) return 1.5;
  return (3 + (goalDifference - 2) / 2) / 4;
}

function getRating(ratings: ReadonlyMap<string, number>, team: string, initialRating: number): number {
  return ratings.get(team) ?? initialRating;
}

function compareMatchesByDate(a: HistoricalMatch, b: HistoricalMatch): number {
  const dateComparison = a.date.localeCompare(b.date);
  if (dateComparison !== 0) return dateComparison;

  const homeComparison = a.homeTeam.localeCompare(b.homeTeam);
  if (homeComparison !== 0) return homeComparison;

  return a.awayTeam.localeCompare(b.awayTeam);
}

function summarizeDateRange(matches: readonly HistoricalMatch[]): DateRangeSummary {
  if (matches.length === 0) {
    return { start: null, end: null };
  }

  const sortedMatches = [...matches].sort(compareMatchesByDate);

  return {
    start: sortedMatches[0]?.date ?? null,
    end: sortedMatches.at(-1)?.date ?? null,
  };
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    ...DEFAULT_BACKTEST_OPTIONS,
    sourceUrl: DEFAULT_RESULTS_URL,
    output: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--") continue;

    const [key, inlineValue] = arg.split("=", 2);

    if (!key.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const value = inlineValue ?? argv[++index];
    if (!value) {
      throw new Error(`Missing value for ${key}`);
    }

    switch (key) {
      case "--input":
        options.input = value;
        break;
      case "--source-url":
        options.sourceUrl = value;
        break;
      case "--output":
        options.output = value;
        break;
      case "--test-start":
        options.testStart = value;
        break;
      case "--test-end":
        options.testEnd = value;
        break;
      case "--sample-forecast-limit":
        options.sampleForecastLimit = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }
  }

  return options;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index++;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  fields.push(current);
  return fields;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function printSummary(report: BacktestReport, outputPath: string): void {
  console.log(
    `Backtest ${report.config.testStart} to ${report.config.testEnd}: ${report.dataset.testMatches} test matches`
  );
  console.log(
    `Model: Brier ${report.metrics.model.brierScore.toFixed(4)}, log loss ${report.metrics.model.logLoss.toFixed(4)}, accuracy ${(
      report.metrics.model.accuracy * 100
    ).toFixed(1)}%`
  );
  console.log(
    `Legacy strength model: Brier ${report.metrics.legacyStrengthModel.brierScore.toFixed(4)}, log loss ${report.metrics.legacyStrengthModel.logLoss.toFixed(4)}`
  );
  console.log(
    `Elo baseline: Brier ${report.metrics.eloBaseline.brierScore.toFixed(4)}, log loss ${report.metrics.eloBaseline.logLoss.toFixed(4)}`
  );
  console.log(
    `Uniform baseline: Brier ${report.metrics.uniformBaseline.brierScore.toFixed(4)}, log loss ${report.metrics.uniformBaseline.logLoss.toFixed(4)}`
  );
  console.log(`Wrote ${formatOutputPath(outputPath)}`);
}

function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return metaUrl === entry;
}

function formatOutputPath(outputPath: string): string {
  const relativeToRepo = path.relative(REPO_ROOT, outputPath);
  if (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo)) {
    return relativeToRepo;
  }

  return outputPath;
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
