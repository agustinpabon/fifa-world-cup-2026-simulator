import assert from "node:assert/strict";
import test from "node:test";

import { type HistoricalMatch } from "./backtest.js";
import {
  DEFAULT_OPTIMIZER_SEARCH_SPACE,
  OPTIMIZER_PARAMETER_KEYS,
  buildGridCandidates,
  formatOptimizationSummary,
  optimizeBacktestParameters,
  type OptimizerSearchSpace,
} from "./optimize.js";

function match(
  date: string,
  homeTeam: string,
  awayTeam: string,
  homeScore: number,
  awayScore: number,
  tournament = "Friendly",
  neutral = false
): HistoricalMatch {
  return { date, homeTeam, awayTeam, homeScore, awayScore, tournament, neutral };
}

test("buildGridCandidates returns a stable Cartesian product of parameter ranges", () => {
  const searchSpace: OptimizerSearchSpace = {
    maxRecentGoalBlend: [0.05, 0.1],
    recentMetricHalfLifeYears: [2],
    recentMetricPriorWeight: [60],
    metricEloScale: [5000],
    useMarginOfVictoryElo: [true],
    marginOfVictoryEloScalingConstant: [2200],
    homeAdvantageElo: [50, 75],
    baseXg: [1.25],
  };

  assert.deepEqual(buildGridCandidates(searchSpace), [
    {
      maxRecentGoalBlend: 0.05,
      recentMetricHalfLifeYears: 2,
      recentMetricPriorWeight: 60,
      metricEloScale: 5000,
      useMarginOfVictoryElo: true,
      marginOfVictoryEloScalingConstant: 2200,
      homeAdvantageElo: 50,
      baseXg: 1.25,
    },
    {
      maxRecentGoalBlend: 0.05,
      recentMetricHalfLifeYears: 2,
      recentMetricPriorWeight: 60,
      metricEloScale: 5000,
      useMarginOfVictoryElo: true,
      marginOfVictoryEloScalingConstant: 2200,
      homeAdvantageElo: 75,
      baseXg: 1.25,
    },
    {
      maxRecentGoalBlend: 0.1,
      recentMetricHalfLifeYears: 2,
      recentMetricPriorWeight: 60,
      metricEloScale: 5000,
      useMarginOfVictoryElo: true,
      marginOfVictoryEloScalingConstant: 2200,
      homeAdvantageElo: 50,
      baseXg: 1.25,
    },
    {
      maxRecentGoalBlend: 0.1,
      recentMetricHalfLifeYears: 2,
      recentMetricPriorWeight: 60,
      metricEloScale: 5000,
      useMarginOfVictoryElo: true,
      marginOfVictoryEloScalingConstant: 2200,
      homeAdvantageElo: 75,
      baseXg: 1.25,
    },
  ]);
});

test("default optimizer search space covers recency decay and margin-of-victory parameters", () => {
  assert.deepEqual(OPTIMIZER_PARAMETER_KEYS, [
    "maxRecentGoalBlend",
    "recentMetricHalfLifeYears",
    "recentMetricPriorWeight",
    "metricEloScale",
    "useMarginOfVictoryElo",
    "marginOfVictoryEloScalingConstant",
    "homeAdvantageElo",
    "baseXg",
  ]);
  assert.ok(DEFAULT_OPTIMIZER_SEARCH_SPACE.recentMetricHalfLifeYears.includes(2));
  assert.deepEqual(DEFAULT_OPTIMIZER_SEARCH_SPACE.useMarginOfVictoryElo, [false, true]);
  assert.ok(DEFAULT_OPTIMIZER_SEARCH_SPACE.marginOfVictoryEloScalingConstant.includes(2200));
});

test("optimizeBacktestParameters ranks candidate configs by rolling log loss then Brier score", () => {
  const matches = [
    match("2020-01-01", "Alpha", "Beta", 2, 0, "Friendly", false),
    match("2020-02-01", "Gamma", "Delta", 0, 0, "Friendly", true),
    match("2021-01-01", "Alpha", "Gamma", 1, 0, "Friendly", false),
    match("2021-02-01", "Beta", "Delta", 0, 1, "Friendly", false),
    match("2022-01-01", "Alpha", "Delta", 2, 1, "Friendly", false),
    match("2022-02-01", "Gamma", "Beta", 1, 1, "Friendly", false),
  ];
  const candidates = buildGridCandidates({
    maxRecentGoalBlend: [0.05, 0.2],
    recentMetricHalfLifeYears: [2],
    recentMetricPriorWeight: [30],
    metricEloScale: [4000],
    useMarginOfVictoryElo: [true],
    marginOfVictoryEloScalingConstant: [2200],
    homeAdvantageElo: [50],
    baseXg: [1.15],
  });
  const result = optimizeBacktestParameters(matches, candidates, {
    windows: [
      { testStart: "2021-01-01", testEnd: "2021-12-31" },
      { testStart: "2022-01-01", testEnd: "2022-12-31" },
    ],
    model: "elo-poisson-strength",
  });
  const [first, second] = result.results;

  assert.equal(result.results.length, 2);
  assert.equal(result.best, first);
  assert.ok(first);
  assert.ok(second);
  assert.ok(Number.isFinite(first.logLoss));
  assert.ok(Number.isFinite(first.brierScore));
  assert.ok(first.logLoss < second.logLoss || first.brierScore <= second.brierScore);
  assert.match(formatOptimizationSummary(result, 2), /Best parameters/);
  assert.match(formatOptimizationSummary(result, 2), /recentMetricHalfLifeYears/);
  assert.match(formatOptimizationSummary(result, 2), /useMarginOfVictoryElo/);
  assert.match(formatOptimizationSummary(result, 2), /baseXg/);
});
