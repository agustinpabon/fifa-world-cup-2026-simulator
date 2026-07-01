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
  predictMatch,
  outcomeForScore,
  outcomeProbabilitiesForVariant,
  parseResultsCsv,
  scoreForecasts,
  summarizeStrengthMetrics,
  trainRatingState,
  type AppliedMatchContextModifier,
  type HistoricalMatch,
  type MatchContextModifiers,
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
  useMarginOfVictoryElo?: boolean;
  marginOfVictoryEloScalingConstant?: number;
  maxRecentGoalBlend?: number;
  recentMetricHalfLifeYears?: number;
  recentMetricPriorWeight?: number;
  metricEloScale?: number;
  baseXg?: number;
  maxGoals?: number;
  dixonColesRho?: number;
  sampleForecastLimit?: number;
  experimentalModifiersEnabled?: boolean;
  experimentalModifierSource?: BacktestModifierSource;
  experimentalModifierProvider?: BacktestModifierProvider;
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
  experimentalModifiers?: ForecastSampleModifiers;
}

export type BacktestModelKey = ModelVariant | "uniform-baseline";

export type BacktestModifierProvider = (match: HistoricalMatch) => MatchContextModifiers | undefined;

export interface BacktestModifierSourceEntry {
  date?: string;
  homeTeam: string;
  awayTeam: string;
  modifiers: MatchContextModifiers;
}

export interface BacktestModifierSource {
  sourceName: string;
  generatedAt?: string;
  notes?: readonly string[];
  entries: readonly BacktestModifierSourceEntry[];
}

export interface BacktestModifierSourceSummary {
  sourceName: string;
  generatedAt: string | null;
  entries: number;
}

export interface ForecastSampleModifiers {
  enabled: boolean;
  baseModel: ModelVariant;
  probabilities: OutcomeProbabilities;
  applied: AppliedMatchContextModifier[];
}

export interface ExperimentalModifiersMetrics {
  base: MetricSummary;
  withModifiers: MetricSummary;
  delta: {
    brierScore: number;
    logLoss: number;
    accuracy: number;
  };
}

export interface WindowExperimentalModifiersReport {
  enabled: boolean;
  baseModel: ModelVariant;
  policy: string;
  source: BacktestModifierSourceSummary | null;
  appliedModifierCount: number;
  sampleApplications: Array<{
    date: string;
    homeTeam: string;
    awayTeam: string;
    applied: AppliedMatchContextModifier[];
  }>;
  metrics: ExperimentalModifiersMetrics | null;
}

export type WindowBacktestConfig = Omit<
  NormalizedBacktestOptions,
  "experimentalModifierSource" | "experimentalModifierProvider"
> & {
  activeModel: ModelVariant;
  rollingUpdate: true;
  experimentalModifierSource: BacktestModifierSourceSummary | null;
};

export interface RollingExperimentalModifiersSummary {
  enabled: boolean;
  policy: string;
  recommendation: "not-evaluated" | "eligible-for-review" | "keep-disabled";
  windowsEvaluated: number;
  windowsImprovedOnBrier: number;
  windowsImprovedOnLogLoss: number;
  averageBrierDelta: number | null;
  averageLogLossDelta: number | null;
}

export interface WindowBacktestReport {
  methodology: string;
  config: WindowBacktestConfig;
  dataset: {
    totalMatches: number;
    trainMatches: number;
    testMatches: number;
    excludedMatches: number;
    trainDateRange: DateRangeSummary;
    testDateRange: DateRangeSummary;
  };
  metrics: Record<BacktestModelKey, MetricSummary>;
  experimentalModifiers: WindowExperimentalModifiersReport;
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
  reportVersion: 4;
  methodology: string;
  activeModel: ModelVariant;
  models: Record<BacktestModelKey, string>;
  selection: ModelSelectionSummary;
  experimentalModifiers: RollingExperimentalModifiersSummary;
  windows: WindowBacktestReport[];
}

interface DateRangeSummary {
  start: string | null;
  end: string | null;
}

interface NormalizedBacktestOptions
  extends Required<
    Omit<BacktestOptions, "experimentalModifierSource" | "experimentalModifierProvider">
  > {
  experimentalModifierSource?: BacktestModifierSource;
  experimentalModifierProvider?: BacktestModifierProvider;
}

interface CliOptions extends Partial<BacktestOptions> {
  input?: string;
  sourceUrl?: string;
  experimentalModifiersPath?: string;
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
const EXPERIMENTAL_MODIFIER_POLICY =
  "Experimental match context modifiers are feature-flagged disabled by default and should not be promoted unless enabled backtests improve both Brier score and log loss in every evaluated window.";

const DEFAULT_BACKTEST_OPTIONS: NormalizedBacktestOptions = {
  testStart: "2024-01-01",
  testEnd: "2024-12-31",
  initialRating: DEFAULT_MODEL_CONFIG.initialRating,
  homeAdvantageElo: DEFAULT_MODEL_CONFIG.homeAdvantageElo,
  useMarginOfVictoryElo: DEFAULT_MODEL_CONFIG.useMarginOfVictoryElo,
  marginOfVictoryEloScalingConstant: DEFAULT_MODEL_CONFIG.marginOfVictoryEloScalingConstant,
  maxRecentGoalBlend: DEFAULT_MODEL_CONFIG.maxRecentGoalBlend,
  recentMetricHalfLifeYears: DEFAULT_MODEL_CONFIG.recentMetricHalfLifeYears,
  recentMetricPriorWeight: DEFAULT_MODEL_CONFIG.recentMetricPriorWeight,
  metricEloScale: DEFAULT_MODEL_CONFIG.metricEloScale,
  baseXg: DEFAULT_MODEL_CONFIG.baseXg,
  maxGoals: DEFAULT_MODEL_CONFIG.maxGoals,
  dixonColesRho: DEFAULT_MODEL_CONFIG.dixonColesRho,
  sampleForecastLimit: 20,
  experimentalModifiersEnabled: false,
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
    useMarginOfVictoryElo: normalized.useMarginOfVictoryElo,
    marginOfVictoryEloScalingConstant: normalized.marginOfVictoryEloScalingConstant,
    maxRecentGoalBlend: normalized.maxRecentGoalBlend,
    recentMetricHalfLifeYears: normalized.recentMetricHalfLifeYears,
    recentMetricPriorWeight: normalized.recentMetricPriorWeight,
    metricEloScale: normalized.metricEloScale,
    baseXg: normalized.baseXg,
    maxGoals: normalized.maxGoals,
    dixonColesRho: normalized.dixonColesRho,
    drawRate: estimateDrawRate(split.train),
  });
  let state = trainRatingState(split.train, { ...baseConfig, referenceYear });
  const forecasts = createForecastBuckets();
  const experimentalBaseForecasts: ScoredForecast[] = [];
  const experimentalModifierForecasts: ScoredForecast[] = [];
  const sampleApplications: WindowExperimentalModifiersReport["sampleApplications"] = [];
  const sampleForecasts: ForecastSample[] = [];
  let appliedModifierCount = 0;

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
    const experimentalModifiers = normalized.experimentalModifiersEnabled
      ? evaluateExperimentalModifiers({
          match,
          baseConfig,
          activeProbabilities: probabilities[ACTIVE_MODEL_VARIANT],
          homeRating,
          awayRating,
          homeMetrics,
          awayMetrics,
          modifiers: getBacktestModifiers(match, normalized),
        })
      : null;

    for (const model of Object.keys(allProbabilities) as BacktestModelKey[]) {
      forecasts[model].push({ probabilities: allProbabilities[model], actual });
    }

    if (experimentalModifiers) {
      experimentalBaseForecasts.push({
        probabilities: experimentalModifiers.baseProbabilities,
        actual,
      });
      experimentalModifierForecasts.push({
        probabilities: experimentalModifiers.probabilities,
        actual,
      });
      appliedModifierCount += experimentalModifiers.applied.length;

      if (experimentalModifiers.applied.length > 0 && sampleApplications.length < normalized.sampleForecastLimit) {
        sampleApplications.push({
          date: match.date,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          applied: experimentalModifiers.applied,
        });
      }
    }

    if (sampleForecasts.length < normalized.sampleForecastLimit) {
      sampleForecasts.push({
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        score: `${match.homeScore}-${match.awayScore}`,
        actual,
        probabilities: allProbabilities,
        ...(experimentalModifiers
          ? {
              experimentalModifiers: {
                enabled: true,
                baseModel: ACTIVE_MODEL_VARIANT,
                probabilities: experimentalModifiers.probabilities,
                applied: experimentalModifiers.applied,
              },
            }
          : {}),
      });
    }

    state = applyMatchToRatingState(state, match, { ...baseConfig, referenceYear });
  }

  return {
    methodology:
      "Rolling-origin historical match backtest: train ratings before the window, score each test match before applying that result, and evaluate calibrated home/draw/away probabilities.",
    config: {
      ...toSerializableBacktestConfig(normalized),
      activeModel: ACTIVE_MODEL_VARIANT,
      rollingUpdate: true,
      experimentalModifierSource: summarizeModifierSource(normalized.experimentalModifierSource),
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
    experimentalModifiers: createWindowExperimentalModifiersReport({
      enabled: normalized.experimentalModifiersEnabled,
      source: summarizeModifierSource(normalized.experimentalModifierSource),
      baseForecasts: experimentalBaseForecasts,
      modifierForecasts: experimentalModifierForecasts,
      appliedModifierCount,
      sampleApplications,
    }),
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
    reportVersion: 4,
    methodology:
      "Annual rolling-origin validation over 2021-2025. Lower Brier score and log loss are better; active model promotion requires consistent improvement over Elo-only. Experimental context modifiers remain disabled by default unless explicitly evaluated and improved across every enabled window.",
    activeModel: selection.activeModel,
    models: modelDescriptions(),
    selection,
    experimentalModifiers: summarizeRollingExperimentalModifiers(reports),
    windows: reports,
  };
}

interface ExperimentalModifierEvaluationInput {
  match: HistoricalMatch;
  baseConfig: ReturnType<typeof createModelConfig>;
  activeProbabilities: OutcomeProbabilities;
  homeRating: number;
  awayRating: number;
  homeMetrics: ReturnType<typeof summarizeStrengthMetrics>;
  awayMetrics: ReturnType<typeof summarizeStrengthMetrics>;
  modifiers: MatchContextModifiers | undefined;
}

interface ExperimentalModifierEvaluation {
  baseProbabilities: OutcomeProbabilities;
  probabilities: OutcomeProbabilities;
  applied: AppliedMatchContextModifier[];
}

function evaluateExperimentalModifiers(
  input: ExperimentalModifierEvaluationInput
): ExperimentalModifierEvaluation {
  const prediction = predictMatch({
    ratingA: input.homeRating,
    ratingB: input.awayRating,
    metricsA: input.homeMetrics,
    metricsB: input.awayMetrics,
    neutral: input.match.neutral,
    modelConfig: {
      ...input.baseConfig,
      variant: ACTIVE_MODEL_VARIANT,
      experimentalModifiersEnabled: true,
    },
    contextModifiers: input.modifiers,
  });

  return {
    baseProbabilities: input.activeProbabilities,
    probabilities: {
      home: prediction.probabilities.pWinA,
      draw: prediction.probabilities.pDraw,
      away: prediction.probabilities.pWinB,
    },
    applied: prediction.modifiers.applied,
  };
}

function getBacktestModifiers(
  match: HistoricalMatch,
  options: NormalizedBacktestOptions
): MatchContextModifiers | undefined {
  const providerModifiers = options.experimentalModifierProvider?.(match);

  if (providerModifiers) {
    return providerModifiers;
  }

  const source = options.experimentalModifierSource;
  if (!source) {
    return undefined;
  }

  return source.entries.find((entry) => isMatchingModifierEntry(entry, match))?.modifiers;
}

function isMatchingModifierEntry(
  entry: BacktestModifierSourceEntry,
  match: HistoricalMatch
): boolean {
  return (
    entry.homeTeam === match.homeTeam &&
    entry.awayTeam === match.awayTeam &&
    (entry.date === undefined || entry.date === match.date)
  );
}

function createWindowExperimentalModifiersReport(input: {
  enabled: boolean;
  source: BacktestModifierSourceSummary | null;
  baseForecasts: readonly ScoredForecast[];
  modifierForecasts: readonly ScoredForecast[];
  appliedModifierCount: number;
  sampleApplications: WindowExperimentalModifiersReport["sampleApplications"];
}): WindowExperimentalModifiersReport {
  const metrics =
    input.enabled && input.baseForecasts.length > 0 && input.modifierForecasts.length > 0
      ? compareExperimentalModifierMetrics(input.baseForecasts, input.modifierForecasts)
      : null;

  return {
    enabled: input.enabled,
    baseModel: ACTIVE_MODEL_VARIANT,
    policy: EXPERIMENTAL_MODIFIER_POLICY,
    source: input.source,
    appliedModifierCount: input.appliedModifierCount,
    sampleApplications: input.sampleApplications,
    metrics,
  };
}

function compareExperimentalModifierMetrics(
  baseForecasts: readonly ScoredForecast[],
  modifierForecasts: readonly ScoredForecast[]
): ExperimentalModifiersMetrics {
  const base = scoreForecasts(baseForecasts);
  const withModifiers = scoreForecasts(modifierForecasts);

  return {
    base,
    withModifiers,
    delta: {
      brierScore: withModifiers.brierScore - base.brierScore,
      logLoss: withModifiers.logLoss - base.logLoss,
      accuracy: withModifiers.accuracy - base.accuracy,
    },
  };
}

function summarizeRollingExperimentalModifiers(
  reports: readonly WindowBacktestReport[]
): RollingExperimentalModifiersSummary {
  const enabledReports = reports.filter((report) => report.experimentalModifiers.enabled);
  const reportsWithMetrics = enabledReports.filter((report) => report.experimentalModifiers.metrics);

  if (reportsWithMetrics.length === 0) {
    return {
      enabled: enabledReports.length > 0,
      policy: EXPERIMENTAL_MODIFIER_POLICY,
      recommendation: "not-evaluated",
      windowsEvaluated: 0,
      windowsImprovedOnBrier: 0,
      windowsImprovedOnLogLoss: 0,
      averageBrierDelta: null,
      averageLogLossDelta: null,
    };
  }

  const deltas = reportsWithMetrics.map((report) => {
    const metrics = report.experimentalModifiers.metrics;
    if (!metrics) {
      throw new Error("Expected experimental modifier metrics after filtering");
    }

    return metrics.delta;
  });
  const windowsImprovedOnBrier = deltas.filter((delta) => delta.brierScore < 0).length;
  const windowsImprovedOnLogLoss = deltas.filter((delta) => delta.logLoss < 0).length;
  const improvedEveryWindow =
    windowsImprovedOnBrier === reportsWithMetrics.length &&
    windowsImprovedOnLogLoss === reportsWithMetrics.length;

  return {
    enabled: true,
    policy: EXPERIMENTAL_MODIFIER_POLICY,
    recommendation: improvedEveryWindow ? "eligible-for-review" : "keep-disabled",
    windowsEvaluated: reportsWithMetrics.length,
    windowsImprovedOnBrier,
    windowsImprovedOnLogLoss,
    averageBrierDelta: mean(deltas.map((delta) => delta.brierScore)),
    averageLogLossDelta: mean(deltas.map((delta) => delta.logLoss)),
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
  const experimentalModifierSource = options.experimentalModifiersPath
    ? parseBacktestModifierSource(
        JSON.parse(await readFile(path.resolve(options.experimentalModifiersPath), "utf8"))
      )
    : undefined;
  const report = runRollingBacktest(matches, windows, {
    ...toBacktestOptions(options),
    ...(experimentalModifierSource ? { experimentalModifierSource } : {}),
  });
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
  const normalized = { ...DEFAULT_BACKTEST_OPTIONS, ...definedOptions } as NormalizedBacktestOptions;

  if (!isIsoDate(normalized.testStart) || !isIsoDate(normalized.testEnd)) {
    throw new Error("testStart and testEnd must be ISO dates in YYYY-MM-DD format");
  }
  if (normalized.testStart > normalized.testEnd) {
    throw new Error(`testStart ${normalized.testStart} must be on or before testEnd ${normalized.testEnd}`);
  }
  assertFiniteOption(normalized.initialRating, "initialRating");
  assertFiniteOption(normalized.homeAdvantageElo, "homeAdvantageElo");
  assertFiniteOption(normalized.marginOfVictoryEloScalingConstant, "marginOfVictoryEloScalingConstant");
  assertFiniteOption(normalized.maxRecentGoalBlend, "maxRecentGoalBlend");
  assertFiniteOption(normalized.recentMetricHalfLifeYears, "recentMetricHalfLifeYears");
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
  if (normalized.marginOfVictoryEloScalingConstant <= 0) {
    throw new Error("marginOfVictoryEloScalingConstant must be positive");
  }
  if (typeof normalized.useMarginOfVictoryElo !== "boolean") {
    throw new Error("useMarginOfVictoryElo must be a boolean");
  }
  if (normalized.recentMetricHalfLifeYears <= 0) {
    throw new Error("recentMetricHalfLifeYears must be positive");
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
  if (typeof normalized.experimentalModifiersEnabled !== "boolean") {
    throw new Error("experimentalModifiersEnabled must be a boolean");
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
    useMarginOfVictoryElo: options.useMarginOfVictoryElo,
    marginOfVictoryEloScalingConstant: options.marginOfVictoryEloScalingConstant,
    maxRecentGoalBlend: options.maxRecentGoalBlend,
    recentMetricHalfLifeYears: options.recentMetricHalfLifeYears,
    recentMetricPriorWeight: options.recentMetricPriorWeight,
    metricEloScale: options.metricEloScale,
    baseXg: options.baseXg,
    maxGoals: options.maxGoals,
    dixonColesRho: options.dixonColesRho,
    sampleForecastLimit: options.sampleForecastLimit,
    experimentalModifiersEnabled:
      options.experimentalModifiersEnabled ?? Boolean(options.experimentalModifiersPath),
  };
}

function toSerializableBacktestConfig(
  options: NormalizedBacktestOptions
): Omit<WindowBacktestConfig, "activeModel" | "rollingUpdate" | "experimentalModifierSource"> {
  return {
    testStart: options.testStart,
    testEnd: options.testEnd,
    initialRating: options.initialRating,
    homeAdvantageElo: options.homeAdvantageElo,
    useMarginOfVictoryElo: options.useMarginOfVictoryElo,
    marginOfVictoryEloScalingConstant: options.marginOfVictoryEloScalingConstant,
    maxRecentGoalBlend: options.maxRecentGoalBlend,
    recentMetricHalfLifeYears: options.recentMetricHalfLifeYears,
    recentMetricPriorWeight: options.recentMetricPriorWeight,
    metricEloScale: options.metricEloScale,
    baseXg: options.baseXg,
    maxGoals: options.maxGoals,
    dixonColesRho: options.dixonColesRho,
    sampleForecastLimit: options.sampleForecastLimit,
    experimentalModifiersEnabled: options.experimentalModifiersEnabled,
  };
}

function summarizeModifierSource(
  source: BacktestModifierSource | undefined
): BacktestModifierSourceSummary | null {
  if (!source) {
    return null;
  }

  return {
    sourceName: source.sourceName,
    generatedAt: source.generatedAt ?? null,
    entries: source.entries.length,
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
      case "--use-margin-of-victory-elo":
        options.useMarginOfVictoryElo = parseBoolean(value, key);
        break;
      case "--margin-of-victory-elo-scaling-constant":
        options.marginOfVictoryEloScalingConstant = parseFiniteNumber(value, key);
        break;
      case "--max-recent-goal-blend":
        options.maxRecentGoalBlend = parseFiniteNumber(value, key);
        break;
      case "--recent-metric-half-life-years":
        options.recentMetricHalfLifeYears = parseFiniteNumber(value, key);
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
      case "--experimental-modifiers":
        options.experimentalModifiersPath = value;
        options.experimentalModifiersEnabled = true;
        break;
      case "--experimental-modifiers-enabled":
        options.experimentalModifiersEnabled = parseBoolean(value, key);
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

function parseBoolean(value: string, flag: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} must be true or false`);
}

function parseBacktestModifierSource(input: unknown): BacktestModifierSource {
  if (!isRecord(input)) {
    throw new Error("Experimental modifiers file must contain a JSON object");
  }

  const sourceName = readNonEmptyString(input.sourceName, "sourceName");
  const generatedAt =
    input.generatedAt === undefined ? undefined : readNonEmptyString(input.generatedAt, "generatedAt");

  if (!Array.isArray(input.entries)) {
    throw new Error("Experimental modifiers file entries must be an array");
  }

  return {
    sourceName,
    ...(generatedAt ? { generatedAt } : {}),
    ...(Array.isArray(input.notes) ? { notes: input.notes.map((note) => String(note)) } : {}),
    entries: input.entries.map(parseBacktestModifierSourceEntry),
  };
}

function parseBacktestModifierSourceEntry(
  input: unknown,
  index: number
): BacktestModifierSourceEntry {
  if (!isRecord(input)) {
    throw new Error(`Experimental modifier entry ${index} must be a JSON object`);
  }

  if (!isRecord(input.modifiers)) {
    throw new Error(`Experimental modifier entry ${index} modifiers must be a JSON object`);
  }

  const date = input.date === undefined ? undefined : readNonEmptyString(input.date, `entries.${index}.date`);

  return {
    ...(date ? { date } : {}),
    homeTeam: readNonEmptyString(input.homeTeam, `entries.${index}.homeTeam`),
    awayTeam: readNonEmptyString(input.awayTeam, `entries.${index}.awayTeam`),
    modifiers: input.modifiers as MatchContextModifiers,
  };
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printSummary(report: RollingBacktestReport, outputPath: string): void {
  console.log(`Active model: ${report.activeModel}`);
  console.log(report.selection.reason);
  console.log(`Experimental modifiers: ${report.experimentalModifiers.recommendation}`);

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
        ...(window.experimentalModifiers.metrics
          ? [
              `modifier Brier delta ${window.experimentalModifiers.metrics.delta.brierScore.toFixed(4)}`,
              `modifier log loss delta ${window.experimentalModifiers.metrics.delta.logLoss.toFixed(4)}`,
            ]
          : []),
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
