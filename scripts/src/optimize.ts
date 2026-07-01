import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACTIVE_MODEL_VARIANT,
  DEFAULT_MODEL_CONFIG,
  MODEL_VARIANTS,
  type ModelVariant,
} from "@workspace/oracle-model";

import {
  DEFAULT_BACKTEST_INPUT,
  DEFAULT_BACKTEST_WINDOWS,
  parseResultsCsv,
  runRollingBacktest,
  type BacktestModelKey,
  type BacktestOptions,
  type CalibrationWindow,
  type HistoricalMatch,
  type RollingBacktestReport,
} from "./backtest.js";

export const OPTIMIZER_PARAMETER_KEYS = [
  "maxRecentGoalBlend",
  "recentMetricHalfLifeYears",
  "recentMetricPriorWeight",
  "metricEloScale",
  "useMarginOfVictoryElo",
  "marginOfVictoryEloScalingConstant",
  "homeAdvantageElo",
  "baseXg",
] as const;

export type OptimizerParameter = (typeof OPTIMIZER_PARAMETER_KEYS)[number];
export type OptimizerCandidate = Required<Pick<BacktestOptions, OptimizerParameter>>;
export type OptimizerSearchSpace = {
  [Key in OptimizerParameter]: readonly NonNullable<BacktestOptions[Key]>[];
};

export interface OptimizerRunOptions {
  windows?: readonly CalibrationWindow[];
  model?: ModelVariant;
  baseBacktestOptions?: Partial<BacktestOptions>;
}

export interface OptimizerResult {
  parameters: OptimizerCandidate;
  matches: number;
  windows: number;
  brierScore: number;
  logLoss: number;
  accuracy: number;
}

export interface OptimizerSummary {
  model: ModelVariant;
  candidatesEvaluated: number;
  best: OptimizerResult;
  results: OptimizerResult[];
}

type SearchMode = "grid" | "random";

interface CliOptions {
  input: string;
  mode: SearchMode;
  iterations: number;
  seed: number;
  top: number;
  model: ModelVariant;
  testStart?: string;
  testEnd?: string;
  searchSpace: OptimizerSearchSpace;
}

export const DEFAULT_OPTIMIZER_SEARCH_SPACE: OptimizerSearchSpace = {
  maxRecentGoalBlend: [0.05, DEFAULT_MODEL_CONFIG.maxRecentGoalBlend, 0.2],
  recentMetricHalfLifeYears: [1, DEFAULT_MODEL_CONFIG.recentMetricHalfLifeYears, 4],
  recentMetricPriorWeight: [30, DEFAULT_MODEL_CONFIG.recentMetricPriorWeight, 120],
  metricEloScale: [3500, DEFAULT_MODEL_CONFIG.metricEloScale, 6500],
  useMarginOfVictoryElo: [false, DEFAULT_MODEL_CONFIG.useMarginOfVictoryElo],
  marginOfVictoryEloScalingConstant: [
    1600,
    DEFAULT_MODEL_CONFIG.marginOfVictoryEloScalingConstant,
    3000,
  ],
  homeAdvantageElo: [50, DEFAULT_MODEL_CONFIG.homeAdvantageElo, 100],
  baseXg: [1.1, DEFAULT_MODEL_CONFIG.baseXg, 1.4],
};

const DEFAULT_RANDOM_ITERATIONS = 32;
const DEFAULT_RANDOM_SEED = 2026;
const DEFAULT_TOP_RESULTS = 10;

export function buildGridCandidates(searchSpace: OptimizerSearchSpace): OptimizerCandidate[] {
  validateSearchSpace(searchSpace);

  return OPTIMIZER_PARAMETER_KEYS.reduce<Array<Partial<OptimizerCandidate>>>(
    (candidates, key) =>
      candidates.flatMap((candidate) =>
        searchSpace[key].map((value) => ({
          ...candidate,
          [key]: value,
        }))
      ),
    [{}]
  ) as OptimizerCandidate[];
}

export function sampleRandomCandidates(
  searchSpace: OptimizerSearchSpace,
  iterations: number,
  seed = DEFAULT_RANDOM_SEED
): OptimizerCandidate[] {
  validateSearchSpace(searchSpace);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("iterations must be a positive integer");
  }

  const maxCombinations = countGridCombinations(searchSpace);
  const target = Math.min(iterations, maxCombinations);
  const random = createSeededRandom(seed);
  const candidates: OptimizerCandidate[] = [];
  const seen = new Set<string>();
  let attempts = 0;

  while (candidates.length < target && attempts < target * 50) {
    attempts += 1;
    const candidate = Object.fromEntries(
      OPTIMIZER_PARAMETER_KEYS.map((key) => {
        const values = searchSpace[key];
        return [key, values[Math.floor(random() * values.length)]];
      })
    ) as OptimizerCandidate;
    const key = candidateKey(candidate);

    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }
  }

  if (candidates.length < target) {
    for (const candidate of buildGridCandidates(searchSpace)) {
      const key = candidateKey(candidate);
      if (!seen.has(key)) {
        candidates.push(candidate);
      }
      if (candidates.length >= target) break;
    }
  }

  return candidates;
}

export function optimizeBacktestParameters(
  matches: readonly HistoricalMatch[],
  candidates: readonly OptimizerCandidate[],
  options: OptimizerRunOptions = {}
): OptimizerSummary {
  if (candidates.length === 0) {
    throw new Error("At least one optimizer candidate is required");
  }

  const model = options.model ?? ACTIVE_MODEL_VARIANT;
  const windows = options.windows ?? DEFAULT_BACKTEST_WINDOWS;
  const results = candidates
    .map((parameters) => {
      const report = runRollingBacktest(matches, windows, {
        sampleForecastLimit: 0,
        ...options.baseBacktestOptions,
        ...parameters,
      });

      return {
        parameters,
        ...aggregateMetrics(report, model),
      };
    })
    .sort(compareOptimizerResults);
  const best = results[0];

  if (!best) {
    throw new Error("Optimizer produced no results");
  }

  return {
    model,
    candidatesEvaluated: results.length,
    best,
    results,
  };
}

export function formatOptimizationSummary(summary: OptimizerSummary, top = DEFAULT_TOP_RESULTS): string {
  const lines = [
    `Optimization target: ${summary.model}`,
    `Candidates evaluated: ${summary.candidatesEvaluated}`,
    "Best parameters:",
    ...formatParameters(summary.best.parameters).map((line) => `  ${line}`),
    `Best metrics: logLoss ${formatMetric(summary.best.logLoss)} | Brier ${formatMetric(
      summary.best.brierScore
    )} | accuracy ${formatMetric(summary.best.accuracy)} | matches ${summary.best.matches}`,
    "",
    `Top ${Math.min(top, summary.results.length)} candidates:`,
  ];

  for (const [index, result] of summary.results.slice(0, top).entries()) {
    lines.push(
      [
        `${index + 1}. logLoss=${formatMetric(result.logLoss)}`,
        `brier=${formatMetric(result.brierScore)}`,
        `accuracy=${formatMetric(result.accuracy)}`,
        ...formatParameters(result.parameters),
      ].join(" | ")
    );
  }

  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(argv);
  const raw = await readFile(path.resolve(options.input), "utf8");
  const matches = parseResultsCsv(raw);
  const windows = buildWindows(options);
  const candidates =
    options.mode === "grid"
      ? buildGridCandidates(options.searchSpace)
      : sampleRandomCandidates(options.searchSpace, options.iterations, options.seed);
  const summary = optimizeBacktestParameters(matches, candidates, {
    windows,
    model: options.model,
  });

  console.log(formatOptimizationSummary(summary, options.top));
}

function aggregateMetrics(report: RollingBacktestReport, model: BacktestModelKey): Omit<OptimizerResult, "parameters"> {
  let matches = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  let accuracyTotal = 0;

  for (const window of report.windows) {
    const metrics = window.metrics[model];
    if (!metrics) {
      throw new Error(`Backtest report does not include metrics for model ${model}`);
    }

    matches += metrics.matches;
    brierTotal += metrics.brierScore * metrics.matches;
    logLossTotal += metrics.logLoss * metrics.matches;
    accuracyTotal += metrics.accuracy * metrics.matches;
  }

  if (matches <= 0) {
    throw new Error("Cannot aggregate optimizer metrics without scored matches");
  }

  return {
    matches,
    windows: report.windows.length,
    brierScore: brierTotal / matches,
    logLoss: logLossTotal / matches,
    accuracy: accuracyTotal / matches,
  };
}

function compareOptimizerResults(left: OptimizerResult, right: OptimizerResult): number {
  return (
    left.logLoss - right.logLoss ||
    left.brierScore - right.brierScore ||
    compareCandidateParameters(left.parameters, right.parameters)
  );
}

function compareCandidateParameters(left: OptimizerCandidate, right: OptimizerCandidate): number {
  for (const key of OPTIMIZER_PARAMETER_KEYS) {
    const comparison = compareParameterValues(left[key], right[key]);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function compareParameterValues(
  left: OptimizerCandidate[OptimizerParameter],
  right: OptimizerCandidate[OptimizerParameter]
): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right));
}

function validateSearchSpace(searchSpace: OptimizerSearchSpace): void {
  for (const key of OPTIMIZER_PARAMETER_KEYS) {
    const values = searchSpace[key];
    if (!values.length) {
      throw new Error(`${key} search range must include at least one value`);
    }
    for (const value of values) {
      if (typeof value === "boolean") {
        continue;
      }

      if (!Number.isFinite(value)) {
        throw new Error(`${key} search range contains a non-finite value`);
      }
    }
  }
}

function countGridCombinations(searchSpace: OptimizerSearchSpace): number {
  return OPTIMIZER_PARAMETER_KEYS.reduce((total, key) => total * searchSpace[key].length, 1);
}

function candidateKey(candidate: OptimizerCandidate): string {
  return OPTIMIZER_PARAMETER_KEYS.map((key) => `${key}:${candidate[key]}`).join("|");
}

function formatParameters(parameters: OptimizerCandidate): string[] {
  return OPTIMIZER_PARAMETER_KEYS.map((key) => `${key}=${parameters[key]}`);
}

function formatMetric(value: number): string {
  return value.toFixed(5);
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    input: DEFAULT_BACKTEST_INPUT,
    mode: "random",
    iterations: DEFAULT_RANDOM_ITERATIONS,
    seed: DEFAULT_RANDOM_SEED,
    top: DEFAULT_TOP_RESULTS,
    model: ACTIVE_MODEL_VARIANT,
    searchSpace: { ...DEFAULT_OPTIMIZER_SEARCH_SPACE },
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
        break;
      case "--mode":
        options.mode = parseSearchMode(value);
        break;
      case "--iterations":
        options.iterations = parsePositiveInteger(value, key);
        break;
      case "--seed":
        options.seed = parsePositiveInteger(value, key);
        break;
      case "--top":
        options.top = parsePositiveInteger(value, key);
        break;
      case "--model":
        options.model = parseModelVariant(value);
        break;
      case "--test-start":
        options.testStart = value;
        break;
      case "--test-end":
        options.testEnd = value;
        break;
      case "--max-recent-goal-blend":
        options.searchSpace = { ...options.searchSpace, maxRecentGoalBlend: parseNumberList(value, key) };
        break;
      case "--recent-metric-half-life-years":
        options.searchSpace = { ...options.searchSpace, recentMetricHalfLifeYears: parseNumberList(value, key) };
        break;
      case "--recent-metric-prior-weight":
        options.searchSpace = { ...options.searchSpace, recentMetricPriorWeight: parseNumberList(value, key) };
        break;
      case "--metric-elo-scale":
        options.searchSpace = { ...options.searchSpace, metricEloScale: parseNumberList(value, key) };
        break;
      case "--use-margin-of-victory-elo":
        options.searchSpace = { ...options.searchSpace, useMarginOfVictoryElo: parseBooleanList(value, key) };
        break;
      case "--margin-of-victory-elo-scaling-constant":
        options.searchSpace = {
          ...options.searchSpace,
          marginOfVictoryEloScalingConstant: parseNumberList(value, key),
        };
        break;
      case "--home-advantage-elo":
        options.searchSpace = { ...options.searchSpace, homeAdvantageElo: parseNumberList(value, key) };
        break;
      case "--base-xg":
        options.searchSpace = { ...options.searchSpace, baseXg: parseNumberList(value, key) };
        break;
      default:
        throw new Error(`Unknown option: ${key}`);
    }
  }

  return options;
}

function buildWindows(options: CliOptions): readonly CalibrationWindow[] {
  if (!options.testStart && !options.testEnd) {
    return DEFAULT_BACKTEST_WINDOWS;
  }
  if (!options.testStart || !options.testEnd) {
    throw new Error("--test-start and --test-end must be supplied together");
  }

  return [{ testStart: options.testStart, testEnd: options.testEnd }];
}

function parseSearchMode(value: string): SearchMode {
  if (value === "grid" || value === "random") return value;
  throw new Error("--mode must be either grid or random");
}

function parseModelVariant(value: string): ModelVariant {
  if ((MODEL_VARIANTS as readonly string[]).includes(value)) return value as ModelVariant;
  throw new Error(`--model must be one of: ${MODEL_VARIANTS.join(", ")}`);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return parsed;
}

function parseNumberList(value: string, flag: string): number[] {
  const values = value.split(",").map((item) => Number.parseFloat(item.trim()));
  if (!values.length || values.some((item) => !Number.isFinite(item))) {
    throw new Error(`${flag} must be a comma-separated list of finite numbers`);
  }

  return values;
}

function parseBooleanList(value: string, flag: string): boolean[] {
  const values = value.split(",").map((item) => parseBoolean(item.trim(), flag));
  if (!values.length) {
    throw new Error(`${flag} must be a comma-separated list of booleans`);
  }

  return values;
}

function parseBoolean(value: string, flag: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${flag} must be true or false`);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
  return metaUrl === entry;
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
