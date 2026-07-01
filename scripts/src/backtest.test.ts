import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ACTIVE_MODEL_VARIANT } from "@workspace/oracle-model";

import {
  DEFAULT_BACKTEST_OUTPUT,
  OUTCOMES,
  poissonOutcomeProbabilities,
  parseResultsCsv,
  runHistoricalBacktest,
  runRollingBacktest,
  scoreForecasts,
  splitMatchesForBacktest,
  type HistoricalMatch,
  type ScoredForecast,
} from "./backtest.js";

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

test("latest generated backtest report matches the promoted active model variant", () => {
  const report = JSON.parse(readFileSync(DEFAULT_BACKTEST_OUTPUT, "utf8")) as {
    activeModel?: unknown;
  };

  assert.equal(report.activeModel, ACTIVE_MODEL_VARIANT);
});

test("parseResultsCsv handles quoted CSV fields without shifting the neutral flag", () => {
  const raw = [
    "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral",
    '2024-01-01,"Alpha, FC",Beta,2,1,Friendly,"City, Region","Country, Republic",TRUE',
  ].join("\n");

  assert.deepEqual(parseResultsCsv(raw), [
    {
      date: "2024-01-01",
      homeTeam: "Alpha, FC",
      awayTeam: "Beta",
      homeScore: 2,
      awayScore: 1,
      tournament: "Friendly",
      neutral: true,
    },
  ]);
});

test("splitMatchesForBacktest separates train and test matches by date", () => {
  const matches = [
    match("2020-01-01", "Alpha", "Beta", 1, 0),
    match("2021-01-01", "Alpha", "Gamma", 2, 0),
    match("2021-12-31", "Beta", "Gamma", 0, 0),
    match("2022-01-01", "Gamma", "Alpha", 1, 3),
  ];

  const split = splitMatchesForBacktest(matches, {
    testStart: "2021-01-01",
    testEnd: "2021-12-31",
  });

  assert.deepEqual(
    split.train.map((entry) => entry.date),
    ["2020-01-01"]
  );
  assert.deepEqual(
    split.test.map((entry) => entry.date),
    ["2021-01-01", "2021-12-31"]
  );
  assert.equal(split.excluded, 1);
});

test("scoreForecasts computes multiclass Brier score, log loss, and confidence calibration", () => {
  const forecasts: ScoredForecast[] = [
    {
      probabilities: { home: 0.7, draw: 0.2, away: 0.1 },
      actual: "home",
    },
    {
      probabilities: { home: 0.6, draw: 0.2, away: 0.2 },
      actual: "away",
    },
  ];

  const result = scoreForecasts(forecasts);

  assert.equal(result.matches, 2);
  assert.equal(result.accuracy, 0.5);
  assert.ok(Math.abs(result.brierScore - 0.59) < 1e-12);
  assert.ok(Math.abs(result.logLoss - ((-Math.log(0.7) - Math.log(0.2)) / 2)) < 1e-12);
  assert.deepEqual(
    result.calibrationBuckets.map((bucket) => ({
      bucket: bucket.bucket,
      count: bucket.count,
      meanConfidence: bucket.meanConfidence,
      accuracy: bucket.accuracy,
    })),
    [
      { bucket: "0.6-0.7", count: 1, meanConfidence: 0.6, accuracy: 0 },
      { bucket: "0.7-0.8", count: 1, meanConfidence: 0.7, accuracy: 1 },
    ]
  );
});

test("poissonOutcomeProbabilities returns normalized probabilities with a stronger home side favored", () => {
  const probabilities = poissonOutcomeProbabilities(1700, 1400, false);
  const total = OUTCOMES.reduce((sum, outcome) => sum + probabilities[outcome], 0);

  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.ok(probabilities.home > probabilities.away);
  assert.ok(probabilities.draw > 0);
});

test("runHistoricalBacktest evaluates a dated holdout against model and baseline metrics", () => {
  const report = runHistoricalBacktest(
    [
      match("2020-01-01", "Alpha", "Beta", 2, 0, "Friendly", false),
      match("2020-02-01", "Gamma", "Delta", 0, 0, "Friendly", true),
      match("2021-01-01", "Alpha", "Gamma", 1, 0, "Friendly", false),
      match("2021-02-01", "Beta", "Delta", 0, 1, "Friendly", false),
    ],
    {
      testStart: "2021-01-01",
      testEnd: "2021-12-31",
      initialRating: 1500,
    }
  );

  assert.equal(report.dataset.trainMatches, 2);
  assert.equal(report.dataset.testMatches, 2);
  assert.deepEqual(Object.keys(report.metrics).sort(), [
    "elo-baseline",
    "elo-poisson",
    "elo-poisson-dixon-coles",
    "elo-poisson-strength",
    "uniform-baseline",
  ]);
  assert.ok(Math.abs(report.metrics["uniform-baseline"].brierScore - 2 / 3) < 1e-12);
  assert.ok(Math.abs(report.metrics["uniform-baseline"].logLoss - Math.log(3)) < 1e-12);
  assert.equal(report.sampleForecasts.length, 2);
  assert.equal(report.sampleForecasts[0]?.date, "2021-01-01");
  assert.ok(report.sampleForecasts[0]?.probabilities["elo-baseline"]);
});

test("runHistoricalBacktest compares attack/defense strength variant against plain Poisson", () => {
  const report = runHistoricalBacktest(
    [
      match("2020-01-01", "Elite", "Weak", 5, 0, "FIFA World Cup", true),
      match("2020-02-01", "Elite", "Weak", 4, 0, "FIFA World Cup", true),
      match("2020-03-01", "Alpha", "Elite", 1, 0, "Friendly", true),
      match("2020-04-01", "Alpha", "Elite", 1, 1, "Friendly", true),
      match("2020-05-01", "Bravo", "Weak", 1, 0, "Friendly", true),
      match("2020-06-01", "Bravo", "Weak", 1, 1, "Friendly", true),
      match("2021-01-01", "Alpha", "Bravo", 2, 1, "FIFA World Cup qualification", true),
      match("2021-02-01", "Bravo", "Alpha", 0, 1, "Friendly", true),
    ],
    {
      testStart: "2021-01-01",
      testEnd: "2021-12-31",
      initialRating: 1500,
    }
  );

  assert.equal(report.metrics["elo-poisson-strength"].matches, report.metrics["elo-poisson"].matches);
  assert.notDeepEqual(
    report.sampleForecasts[0]?.probabilities["elo-poisson-strength"],
    report.sampleForecasts[0]?.probabilities["elo-poisson"]
  );
});

test("runHistoricalBacktest applies XG and strength metric parameter overrides", () => {
  const matches = [
    match("2020-01-01", "Elite", "Weak", 5, 0, "FIFA World Cup", true),
    match("2020-02-01", "Elite", "Weak", 4, 0, "FIFA World Cup", true),
    match("2020-03-01", "Alpha", "Elite", 1, 0, "Friendly", true),
    match("2020-04-01", "Alpha", "Elite", 1, 1, "Friendly", true),
    match("2020-05-01", "Bravo", "Weak", 1, 0, "Friendly", true),
    match("2020-06-01", "Bravo", "Weak", 1, 1, "Friendly", true),
    match("2021-01-01", "Alpha", "Bravo", 2, 1, "FIFA World Cup qualification", false),
  ];
  const baseline = runHistoricalBacktest(matches, {
    testStart: "2021-01-01",
    testEnd: "2021-12-31",
    initialRating: 1500,
    sampleForecastLimit: 1,
  });
  const tuned = runHistoricalBacktest(matches, {
    testStart: "2021-01-01",
    testEnd: "2021-12-31",
    initialRating: 1500,
    homeAdvantageElo: 75,
    useMarginOfVictoryElo: false,
    marginOfVictoryEloScalingConstant: 1800,
    maxRecentGoalBlend: 0.4,
    recentMetricHalfLifeYears: 1.5,
    recentMetricPriorWeight: 10,
    metricEloScale: 2500,
    baseXg: 1.75,
    sampleForecastLimit: 1,
  });

  assert.equal(tuned.config.homeAdvantageElo, 75);
  assert.equal(tuned.config.useMarginOfVictoryElo, false);
  assert.equal(tuned.config.marginOfVictoryEloScalingConstant, 1800);
  assert.equal(tuned.config.maxRecentGoalBlend, 0.4);
  assert.equal(tuned.config.recentMetricHalfLifeYears, 1.5);
  assert.equal(tuned.config.recentMetricPriorWeight, 10);
  assert.equal(tuned.config.metricEloScale, 2500);
  assert.equal(tuned.config.baseXg, 1.75);
  assert.notDeepEqual(
    tuned.sampleForecasts[0]?.probabilities["elo-poisson-strength"],
    baseline.sampleForecasts[0]?.probabilities["elo-poisson-strength"]
  );
});

test("runHistoricalBacktest can compare base forecasts against opt-in context modifiers", () => {
  const report = runHistoricalBacktest(
    [
      match("2020-01-01", "Alpha", "Beta", 2, 0, "Friendly", false),
      match("2020-02-01", "Gamma", "Delta", 0, 0, "Friendly", true),
      match("2021-01-01", "Alpha", "Gamma", 0, 1, "Friendly", false),
      match("2021-02-01", "Beta", "Delta", 2, 0, "Friendly", false),
    ],
    {
      testStart: "2021-01-01",
      testEnd: "2021-12-31",
      initialRating: 1500,
      experimentalModifiersEnabled: true,
      experimentalModifierProvider: (candidate) => ({
        manual: [
          {
            target: "teamA",
            adjustments: { eloDelta: 80, xgMultiplier: 1.2 },
            explanation: `Synthetic boost for ${candidate.homeTeam}; intentionally not assumed valid.`,
            provenance: {
              source: "unit-test",
              sourceId: `${candidate.date}:${candidate.homeTeam}:${candidate.awayTeam}`,
            },
          },
        ],
      }),
    }
  );

  assert.equal(report.experimentalModifiers.enabled, true);
  assert.equal(report.experimentalModifiers.baseModel, ACTIVE_MODEL_VARIANT);
  assert.equal(report.experimentalModifiers.appliedModifierCount, 2);
  assert.ok(report.experimentalModifiers.metrics);
  assert.equal(report.experimentalModifiers.metrics.base.matches, 2);
  assert.equal(report.experimentalModifiers.metrics.withModifiers.matches, 2);
  assert.equal(
    report.experimentalModifiers.metrics.delta.brierScore,
    report.experimentalModifiers.metrics.withModifiers.brierScore -
      report.experimentalModifiers.metrics.base.brierScore
  );
  assert.equal(
    report.experimentalModifiers.metrics.delta.logLoss,
    report.experimentalModifiers.metrics.withModifiers.logLoss -
      report.experimentalModifiers.metrics.base.logLoss
  );
  assert.equal(report.sampleForecasts[0]?.experimentalModifiers?.enabled, true);
  assert.equal(report.sampleForecasts[0]?.experimentalModifiers?.applied.length, 1);
});

test("runRollingBacktest selects an active model no worse than the Elo baseline", () => {
  const report = runRollingBacktest(
    [
      match("2020-01-01", "Alpha", "Beta", 2, 0, "Friendly", false),
      match("2020-02-01", "Gamma", "Delta", 0, 0, "Friendly", true),
      match("2021-01-01", "Alpha", "Gamma", 1, 0, "Friendly", false),
      match("2021-02-01", "Beta", "Delta", 0, 1, "Friendly", false),
      match("2022-01-01", "Alpha", "Delta", 2, 1, "Friendly", false),
      match("2022-02-01", "Gamma", "Beta", 1, 1, "Friendly", false),
    ],
    [
      { testStart: "2021-01-01", testEnd: "2021-12-31" },
      { testStart: "2022-01-01", testEnd: "2022-12-31" },
    ],
    { sampleForecastLimit: 0 }
  );

  for (const window of report.windows) {
    assert.ok(
      window.metrics[report.activeModel].brierScore <= window.metrics["elo-baseline"].brierScore
    );
    assert.ok(
      window.metrics[report.activeModel].logLoss <= window.metrics["elo-baseline"].logLoss
    );
  }
});

test("runRollingBacktest keeps experimental modifiers disabled unless every enabled window improves metrics", () => {
  const report = runRollingBacktest(
    [
      match("2020-01-01", "Alpha", "Beta", 2, 0, "Friendly", false),
      match("2020-02-01", "Gamma", "Delta", 0, 0, "Friendly", true),
      match("2021-01-01", "Alpha", "Gamma", 0, 1, "Friendly", false),
      match("2021-02-01", "Beta", "Delta", 2, 0, "Friendly", false),
      match("2022-01-01", "Alpha", "Delta", 0, 1, "Friendly", false),
      match("2022-02-01", "Gamma", "Beta", 2, 0, "Friendly", false),
    ],
    [
      { testStart: "2021-01-01", testEnd: "2021-12-31" },
      { testStart: "2022-01-01", testEnd: "2022-12-31" },
    ],
    {
      sampleForecastLimit: 0,
      experimentalModifiersEnabled: true,
      experimentalModifierProvider: (candidate) => ({
        manual: [
          {
            target: "teamA",
            adjustments: { eloDelta: 80, xgMultiplier: 1.2 },
            explanation: `Synthetic home-side boost for ${candidate.homeTeam}; validation fixture only.`,
            provenance: { source: "unit-test", sourceId: candidate.date },
          },
        ],
      }),
    }
  );

  assert.equal(report.experimentalModifiers.enabled, true);
  assert.equal(report.experimentalModifiers.windowsEvaluated, 2);
  assert.equal(report.experimentalModifiers.recommendation, "keep-disabled");
  assert.match(report.experimentalModifiers.policy, /disabled by default/i);
});
