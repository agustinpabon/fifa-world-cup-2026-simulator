import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACTIVE_MODEL_VARIANT,
  DEFAULT_MODEL_CONFIG,
  MODEL_VARIANTS,
  OUTCOMES,
  applyMatchToRatingState,
  compareMatchesByDate,
  createModelConfig,
  describeModelVariant,
  estimateDrawRate,
  getRating,
  outcomeForScore,
  outcomeProbabilitiesForVariant,
  parseResultsCsv,
  scoreForecasts,
  summarizeStrengthMetrics,
  trainRatingState,
  type HistoricalMatch,
  type MetricSummary,
  type ModelVariant,
  type Outcome,
  type OutcomeProbabilities,
  type ScoredForecast,
} from "@workspace/oracle-model";

export { OUTCOMES, parseResultsCsv, scoreForecasts, type HistoricalMatch, type ScoredForecast };

export interface BacktestOptions {
  testStart: string;
  testEnd: string;
  initialRating?: number;
  homeAdvantageElo?: number;
  maxRecentGoalBlend?: number;
  recentMetricPriorWeight?: number;
  metricEloScale?: number;
  baseXg?: number;
  maxGoals?: number;
  dixonColesRho?: number;
  sampleForecastLimit?: number;
}

export interface BacktestSplit {
  train: HistoricalMatch[];
  test: HistoricalMatch[];
  excluded: number;
}

export interface CalibrationWindow {
  testStart: string;
  testEnd: string;
}

export interface ForecastSample {
  date: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  actual: Outcome;
  probabilities: Record<BacktestModelKey, OutcomeProbabilities>;
}

export type BacktestModelKey = ModelVariant | "uniform-baseline";

export interface WindowBacktestReport {
  methodology: string;
  config: Required<BacktestOptions> & {
    activeModel: ModelVariant;
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
  metrics: Record<BacktestModelKey, MetricSummary>;
  sampleForecasts: ForecastSample[];
}

export interface ModelSelectionSummary {
  activeModel: ModelVariant;
  baselineModel: "elo-baseline";
  primaryMetric: "logLoss";
  reason: string;
  candidateResults: Array<{
    model: ModelVariant;
    windowsBetterThanBaselineOnBrier: number;
    windowsBetterThanBaselineOnLogLoss: number;
    windowsEvaluated: number;
    averageBrierDeltaVsBaseline: number;
    averageLogLossDeltaVsBaseline: number;
  }>;
}

export interface RollingBacktestReport {
  reportVersion: 3;
  methodology: string;
  activeModel: ModelVariant;
  models: Record<BacktestModelKey, string>;
  selection: ModelSelectionSummary;
  windows: WindowBacktestReport[];
}

interface DateRangeSummary {
  start: string | null;
  end: string | null;
}

interface NormalizedBacktestOptions extends Required<BacktestOptions> {}

interface CliOptions extends Partial<BacktestOptions> {
  input?: string;
  sourceUrl?: string;
  output: string;
}

export const DEFAULT_BACKTEST_WINDOWS: CalibrationWindow[] = [
  { testStart: "2021-01-01", testEnd: "2021-12-31" },
  { testStart: "2022-01-01", testEnd: "2022-12-31" },
  { testStart: "2023-01-01", testEnd: "2023-12-31" },
  { testStart: "2024-01-01", testEnd: "2024-12-31" },
  { testStart: "2025-01-01", testEnd: "2025-12-31" },
];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_BACKTEST_INPUT = path.join(
  REPO_ROOT,
  "artifacts/api-server/src/data/international-results.snapshot.csv"
);
export const DEFAULT_BACKTEST_OUTPUT = path.join(REPO_ROOT, "reports/backtests/latest.json");
const DEFAULT_RESULTS_URL =
  "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";

const DEFAULT_BACKTEST_OPTIONS: NormalizedBacktestOptions = {
  testStart: "2024-01-01",
  testEnd: "2024-12-31",
  initialRating: DEFAULT_MODEL_CONFIG.initialRating,
  homeAdvantageElo: DEFAULT_MODEL_CONFIG.homeAdvantageElo,
  maxRecentGoalBlend: DEFAULT_MODEL_CONFIG.maxRecentGoalBlend,
  recentMetricPriorWeight: DEFAULT_MODEL_CONFIG.recentMetricPriorWeight,
  metricEloScale: DEFAULT_MODEL_CONFIG.metricEloScale,
  baseXg: DEFAULT_MODEL_CONFIG.baseXg,
  maxGoals: DEFAULT_MODEL_CONFIG.maxGoals,
  dixonColesRho: DEFAULT_MODEL_CONFIG.dixonColesRho,
  sampleForecastLimit: 20,
};

const UNIFORM_PROBABILITIES: OutcomeProbabilities = {
  home: 1 / 3,
  draw: 1 / 3,
  away: 1 / 3,
};

export function splitMatchesForBacktest(
  matches: readonly HistoricalMatch[],
  options: BacktestOptions
): BacktestSplit {
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
  options: Partial<
    Pick<BacktestOptions, "homeAdvantageElo" | "baseXg" | "maxGoals" | "dixonColesRho">
  > = {}
): OutcomeProbabilities {
  return outcomeProbabilitiesForVariant({
    ratingA: homeRating,
    ratingB: awayRating,
    neutral,
    modelConfig: {
      homeAdvantageElo: options.homeAdvantageElo,
      baseXg: options.baseXg,
      maxGoals: options.maxGoals,
      dixonColesRho: options.dixonColesRho,
      variant: "elo-poisson-dixon-coles",
    },
  });
}

export function runHistoricalBacktest(
  matches: readonly HistoricalMatch[],
  options: BacktestOptions
): WindowBacktestReport {
  const normalized = normalizeBacktestOptions(options);
  const split = splitMatchesForBacktest(matches, normalized);

  if (split.train.length === 0) {
    throw new Error(`Backtest needs at least one training match before ${normalized.testStart}`);
  }
  if (split.test.length === 0) {
    throw new Error(`Backtest has no test matches from ${normalized.testStart} to ${normalized.testEnd}`);
  }

  const referenceYear = Number.parseInt(normalized.testStart.slice(0, 4), 10);
  const baseConfig = createModelConfig({
    initialRating: normalized.initialRating,
    fallbackRating: normalized.initialRating,
    homeAdvantageElo: normalized.homeAdvantageElo,
    maxRecentGoalBlend: normalized.maxRecentGoalBlend,
    recentMetricPriorWeight: normalized.recentMetricPriorWeight,
    metricEloScale: normalized.metricEloScale,
    baseXg: normalized.baseXg,
    maxGoals: normalized.maxGoals,
    dixonColesRho: normalized.dixonColesRho,
    drawRate: estimateDrawRate(split.train),
  });
  let state = trainRatingState(split.train, { ...baseConfig, referenceYear });
  const forecasts = createForecastBuckets();
  const sampleForecasts: ForecastSample[] = [];

  for (const match of split.test) {
    const homeRating = getRating(state.ratings, match.homeTeam, baseConfig.initialRating);
    const awayRating = getRating(state.ratings, match.awayTeam, baseConfig.initialRating);
    const homeMetrics = summarizeStrengthMetrics(state.samples, match.homeTeam, match.date, homeRating, baseConfig);
    const awayMetrics = summarizeStrengthMetrics(state.samples, match.awayTeam, match.date, awayRating, baseConfig);
    const actual = outcomeForScore(match.homeScore, match.awayScore);
    const probabilities = Object.fromEntries(
      MODEL_VARIANTS.map((variant) => [
        variant,
        outcomeProbabilitiesForVariant({
          ratingA: homeRating,
          ratingB: awayRating,
          metricsA: homeMetrics,
          metricsB: awayMetrics,
          neutral: match.neutral,
          modelConfig: { ...baseConfig, variant },
        }),
      ])
    ) as Record<ModelVariant, OutcomeProbabilities>;
    const allProbabilities: Record<BacktestModelKey, OutcomeProbabilities> = {
      ...probabilities,
      "uniform-baseline": UNIFORM_PROBABILITIES,
    };

    for (const model of Object.keys(allProbabilities) as BacktestModelKey[]) {
      forecasts[model].push({ probabilities: allProbabilities[model], actual });
    }

    if (sampleForecasts.length < normalized.sampleForecastLimit) {
      sampleForecasts.push({
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        score: `${match.homeScore}-${match.awayScore}`,
        actual,
        probabilities: allProbabilities,
      });
    }

    state = applyMatchToRatingState(state, match, { ...baseConfig, referenceYear });
  }

  return {
    methodology:
      "Rolling-origin historical match backtest: train ratings before the window, score each test match before applying that result, and evaluate calibrated home/draw/away probabilities.",
    config: {
      ...normalized,
      activeModel: ACTIVE_MODEL_VARIANT,
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
    metrics: Object.fromEntries(
      (Object.keys(forecasts) as BacktestModelKey[]).map((model) => [model, scoreForecasts(forecasts[model])])
    ) as Record<BacktestModelKey, MetricSummary>,
    sampleForecasts,
  };
}

export function runRollingBacktest(
  matches: readonly HistoricalMatch[],
  windows: readonly CalibrationWindow[] = DEFAULT_BACKTEST_WINDOWS,
  options: Partial<BacktestOptions> = {}
): RollingBacktestReport {
  const reports = windows.map((window) =>
    runHistoricalBacktest(matches, {
      ...options,
      testStart: window.testStart,
      testEnd: window.testEnd,
    })
  );
  const selection = selectActiveModel(reports);

  return {
    reportVersion: 3,
    methodology:
      "Annual rolling-origin validation over 2021-2025. Lower Brier score and log loss are better; active model promotion requires consistent improvement over Elo-only.",
    activeModel: selection.activeModel,
    models: modelDescriptions(),
    selection,
    windows: reports,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(argv);
  const raw = options.sourceUrl
    ? await fetchText(options.sourceUrl)
    : await readFile(path.resolve(options.input ?? DEFAULT_BACKTEST_INPUT), "utf8");
  const matches = parseResultsCsv(raw);
  const windows =
    options.testStart && options.testEnd
      ? [{ testStart: options.testStart, testEnd: options.testEnd }]
      : DEFAULT_BACKTEST_WINDOWS;
  const report = runRollingBacktest(matches, windows, toBacktestOptions(options));
  const outputPath = path.resolve(options.output);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  printSummary(report, outputPath);
}

function selectActiveModel(reports: readonly WindowBacktestReport[]): ModelSelectionSummary {
  const candidates = MODEL_VARIANTS.filter((variant) => variant !== "elo-baseline");
  const candidateResults = candidates.map((model) => summarizeCandidate(model, reports));
  const consistentImprovers = candidateResults.filter(
    (candidate) =>
      candidate.windowsBetterThanBaselineOnBrier === candidate.windowsEvaluated &&
      candidate.windowsBetterThanBaselineOnLogLoss === candidate.windowsEvaluated
  );

  if (consistentImprovers.length === 0) {
    return {
      activeModel: "elo-baseline",
      baselineModel: "elo-baseline",
      primaryMetric: "logLoss",
      reason:
        "No richer model variant beat the Elo-only baseline on both Brier score and log loss in every evaluated annual window, so the simpler calibrated Elo baseline remains active.",
      candidateResults,
    };
  }

  const [winner] = [...consistentImprovers].sort(
    (a, b) => a.averageLogLossDeltaVsBaseline - b.averageLogLossDeltaVsBaseline
  );

  return {
    activeModel: winner.model,
    baselineModel: "elo-baseline",
    primaryMetric: "logLoss",
    reason: `${winner.model} beat the Elo-only baseline on Brier score and log loss in every evaluated annual window.`,
    candidateResults,
  };
}

function summarizeCandidate(model: ModelVariant, reports: readonly WindowBacktestReport[]) {
  const deltas = reports.map((report) => {
    const baseline = report.metrics["elo-baseline"];
    const candidate = report.metrics[model];

    return {
      brierDelta: candidate.brierScore - baseline.brierScore,
      logLossDelta: candidate.logLoss - baseline.logLoss,
    };
  });

  return {
    model,
    windowsBetterThanBaselineOnBrier: deltas.filter((delta) => delta.brierDelta < 0).length,
    windowsBetterThanBaselineOnLogLoss: deltas.filter((delta) => delta.logLossDelta < 0).length,
    windowsEvaluated: reports.length,
    averageBrierDeltaVsBaseline: mean(deltas.map((delta) => delta.brierDelta)),
    averageLogLossDeltaVsBaseline: mean(deltas.map((delta) => delta.logLossDelta)),
  };
}

function createForecastBuckets(): Record<BacktestModelKey, ScoredForecast[]> {
  const buckets = {} as Record<BacktestModelKey, ScoredForecast[]>;

  for (const model of [...MODEL_VARIANTS, "uniform-baseline"] as BacktestModelKey[]) {
    buckets[model] = [];
  }

  return buckets;
}

function modelDescriptions(): Record<BacktestModelKey, string> {
  return {
    "elo-baseline": describeModelVariant("elo-baseline"),
    "elo-poisson": describeModelVariant("elo-poisson"),
    "elo-poisson-dixon-coles": describeModelVariant("elo-poisson-dixon-coles"),
    "elo-poisson-strength": describeModelVariant("elo-poisson-strength"),
    "uniform-baseline": "Uniform baseline: fixed 1/3 probability for home win, draw, and away win.",
  };
}

function normalizeBacktestOptions(options: BacktestOptions): NormalizedBacktestOptions {
  const definedOptions = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  ) as Partial<BacktestOptions>;
  const normalized = { ...DEFAULT_BACKTEST_OPTIONS, ...definedOptions };

  if (!isIsoDate(normalized.testStart) || !isIsoDate(normalized.testEnd)) {
    throw new Error("testStart and testEnd must be ISO dates in YYYY-MM-DD format");
  }
  if (normalized.testStart > normalized.testEnd) {
    throw new Error(`testStart ${normalized.testStart} must be on or before testEnd ${normalized.testEnd}`);
  }
  assertFiniteOption(normalized.initialRating, "initialRating");
  assertFiniteOption(normalized.homeAdvantageElo, "homeAdvantageElo");
  assertFiniteOption(normalized.maxRecentGoalBlend, "maxRecentGoalBlend");
  assertFiniteOption(normalized.recentMetricPriorWeight, "recentMetricPriorWeight");
  assertFiniteOption(normalized.metricEloScale, "metricEloScale");
  assertFiniteOption(normalized.baseXg, "baseXg");
  assertFiniteOption(normalized.dixonColesRho, "dixonColesRho");
  if (!Number.isInteger(normalized.maxGoals) || normalized.maxGoals < 4) {
    throw new Error("maxGoals must be at least 4");
  }
  if (normalized.maxRecentGoalBlend < 0 || normalized.maxRecentGoalBlend > 1) {
    throw new Error("maxRecentGoalBlend must be between 0 and 1");
  }
  if (normalized.recentMetricPriorWeight < 0) {
    throw new Error("recentMetricPriorWeight must be non-negative");
  }
  if (normalized.metricEloScale <= 0) {
    throw new Error("metricEloScale must be positive");
  }
  if (normalized.baseXg <= 0) {
    throw new Error("baseXg must be positive");
  }
  if (!Number.isInteger(normalized.sampleForecastLimit) || normalized.sampleForecastLimit < 0) {
    throw new Error("sampleForecastLimit must be a non-negative integer");
  }

  return normalized;
}

function assertFiniteOption(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function toBacktestOptions(options: CliOptions): Partial<BacktestOptions> {
  return {
    initialRating: options.initialRating,
    homeAdvantageElo: options.homeAdvantageElo,
    maxRecentGoalBlend: options.maxRecentGoalBlend,
    recentMetricPriorWeight: options.recentMetricPriorWeight,
    metricEloScale: options.metricEloScale,
    baseXg: options.baseXg,
    maxGoals: options.maxGoals,
    dixonColesRho: options.dixonColesRho,
    sampleForecastLimit: options.sampleForecastLimit,
  };
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

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    input: DEFAULT_BACKTEST_INPUT,
    output: DEFAULT_BACKTEST_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
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
        options.sourceUrl = undefined;
        break;
      case "--source-url":
        options.sourceUrl = value === "default" ? DEFAULT_RESULTS_URL : value;
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
      case "--initial-rating":
        options.initialRating = parseFiniteNumber(value, key);
        break;
      case "--home-advantage-elo":
        options.homeAdvantageElo = parseFiniteNumber(value, key);
        break;
      case "--max-recent-goal-blend":
        options.maxRecentGoalBlend = parseFiniteNumber(value, key);
        break;
      case "--recent-metric-prior-weight":
        options.recentMetricPriorWeight = parseFiniteNumber(value, key);
        break;
      case "--metric-elo-scale":
        options.metricEloScale = parseFiniteNumber(value, key);
        break;
      case "--base-xg":
        options.baseXg = parseFiniteNumber(value, key);
        break;
      case "--max-goals":
        options.maxGoals = Number.parseInt(value, 10);
        break;
      case "--dixon-coles-rho":
        options.dixonColesRho = parseFiniteNumber(value, key);
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

function parseFiniteNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a finite number`);
  }

  return parsed;
}

function printSummary(report: RollingBacktestReport, outputPath: string): void {
  console.log(`Active model: ${report.activeModel}`);
  console.log(report.selection.reason);

  for (const window of report.windows) {
    const baseline = window.metrics["elo-baseline"];
    const active = window.metrics[report.activeModel];
    const uniform = window.metrics["uniform-baseline"];
    console.log(
      [
        `${window.config.testStart} to ${window.config.testEnd}`,
        `${window.dataset.testMatches} matches`,
        `active Brier ${active.brierScore.toFixed(4)}`,
        `active log loss ${active.logLoss.toFixed(4)}`,
        `Elo Brier ${baseline.brierScore.toFixed(4)}`,
        `Elo log loss ${baseline.logLoss.toFixed(4)}`,
        `uniform Brier ${uniform.brierScore.toFixed(4)}`,
      ].join(" | ")
    );
  }

  console.log(`Wrote ${formatOutputPath(outputPath)}`);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
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
