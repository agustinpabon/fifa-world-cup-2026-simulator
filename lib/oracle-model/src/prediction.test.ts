import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScoreProbabilityMatrix,
  dixonColesAdjustment,
  predictMatch,
  sampleMatchScore,
} from "./prediction.js";

function sumProbability(matrix: readonly { probability: number }[]): number {
  return matrix.reduce((sum, cell) => sum + cell.probability, 0);
}

function cellProbability(
  matrix: readonly { goalsA: number; goalsB: number; probability: number }[],
  goalsA: number,
  goalsB: number
): number {
  return matrix.find((cell) => cell.goalsA === goalsA && cell.goalsB === goalsB)?.probability ?? 0;
}

test("Dixon-Coles adjusted score matrix is normalized and does not cap positive low-score adjustments at one", () => {
  const poisson = buildScoreProbabilityMatrix(1.2, 1.1, { useDixonColes: false });
  const adjusted = buildScoreProbabilityMatrix(1.2, 1.1, { useDixonColes: true, dixonColesRho: -0.06 });

  assert.ok(Math.abs(sumProbability(adjusted) - 1) < 1e-12);
  assert.ok(dixonColesAdjustment(1.2, 1.1, 0, 0, -0.06) > 1);
  assert.ok(dixonColesAdjustment(1.2, 1.1, 1, 1, -0.06) > 1);
  assert.ok(cellProbability(adjusted, 0, 0) > cellProbability(poisson, 0, 0));
  assert.ok(cellProbability(adjusted, 1, 1) > cellProbability(poisson, 1, 1));
  assert.ok(cellProbability(adjusted, 1, 0) < cellProbability(poisson, 1, 0));
  assert.ok(cellProbability(adjusted, 0, 1) < cellProbability(poisson, 0, 1));
});

test("equivalent neutral teams are symmetric and normalized", () => {
  const prediction = predictMatch({
    ratingA: 1500,
    ratingB: 1500,
    modelConfig: { variant: "elo-baseline", drawRate: 0.27 },
  });

  assert.ok(Math.abs(prediction.probabilities.pWinA - prediction.probabilities.pWinB) < 1e-12);
  assert.ok(
    Math.abs(
      prediction.probabilities.pWinA + prediction.probabilities.pDraw + prediction.probabilities.pWinB - 1
    ) < 1e-12
  );
});

test("categorical score sampling follows the final reweighted probability matrix", () => {
  const prediction = predictMatch({
    ratingA: 1700,
    ratingB: 1400,
    modelConfig: { variant: "elo-baseline", drawRate: 0.2 },
  });
  const first = prediction.scoreMatrix[0];

  assert.ok(first);
  assert.deepEqual(
    sampleMatchScore(
      {
        ratingA: 1700,
        ratingB: 1400,
        modelConfig: { variant: "elo-baseline", drawRate: 0.2 },
      },
      () => first.probability / 2
    ),
    { goalsA: first.goalsA, goalsB: first.goalsB }
  );
});

test("match context modifiers are ignored unless explicitly enabled", () => {
  const baseline = predictMatch({
    ratingA: 1500,
    ratingB: 1500,
    modelConfig: { variant: "elo-poisson" },
  });
  const disabled = predictMatch({
    ratingA: 1500,
    ratingB: 1500,
    modelConfig: { variant: "elo-poisson" },
    contextModifiers: {
      manual: [
        {
          target: "teamA",
          adjustments: { eloDelta: 100, xgMultiplier: 1.2 },
          explanation: "Synthetic experiment: boost Team A only for opt-in tests.",
          provenance: { source: "unit-test", sourceId: "disabled-modifier" },
        },
      ],
    },
  });
  const enabled = predictMatch({
    ratingA: 1500,
    ratingB: 1500,
    modelConfig: { variant: "elo-poisson", experimentalModifiersEnabled: true },
    contextModifiers: {
      manual: [
        {
          target: "teamA",
          adjustments: { eloDelta: 100, xgMultiplier: 1.2 },
          explanation: "Synthetic experiment: boost Team A only for opt-in tests.",
          provenance: { source: "unit-test", sourceId: "enabled-modifier" },
        },
      ],
    },
  });

  assert.deepEqual(disabled.probabilities, baseline.probabilities);
  assert.equal(disabled.xgA, baseline.xgA);
  assert.equal(disabled.modifiers.enabled, false);
  assert.equal(disabled.modifiers.ignoredCount, 1);
  assert.equal(enabled.modifiers.enabled, true);
  assert.equal(enabled.modifiers.applied.length, 1);
  assert.equal(enabled.modifiers.applied[0]?.explanation.includes("boost Team A"), true);
  assert.equal(enabled.modifiers.applied[0]?.provenance.source, "unit-test");
  assert.ok(enabled.probabilities.pWinA > baseline.probabilities.pWinA);
});

test("match context modifiers remain symmetric when teams and targets are swapped", () => {
  const left = predictMatch({
    ratingA: 1580,
    ratingB: 1510,
    modelConfig: { variant: "elo-poisson", experimentalModifiersEnabled: true },
    contextModifiers: {
      availability: [
        {
          target: "teamA",
          adjustments: { eloDelta: -35, xgMultiplier: 0.92 },
          explanation: "Synthetic availability experiment for Team A.",
          provenance: { source: "unit-test", sourceId: "availability-a" },
        },
      ],
    },
  });
  const right = predictMatch({
    ratingA: 1510,
    ratingB: 1580,
    modelConfig: { variant: "elo-poisson", experimentalModifiersEnabled: true },
    contextModifiers: {
      availability: [
        {
          target: "teamB",
          adjustments: { eloDelta: -35, xgMultiplier: 0.92 },
          explanation: "Synthetic availability experiment for Team B.",
          provenance: { source: "unit-test", sourceId: "availability-b" },
        },
      ],
    },
  });

  assert.ok(Math.abs(left.probabilities.pWinA - right.probabilities.pWinB) < 1e-12);
  assert.ok(Math.abs(left.probabilities.pWinB - right.probabilities.pWinA) < 1e-12);
  assert.ok(Math.abs(left.probabilities.pDraw - right.probabilities.pDraw) < 1e-12);
  assert.equal(left.xgA, right.xgB);
  assert.equal(left.xgB, right.xgA);
});

test("match context modifiers are bounded and keep probabilities normalized", () => {
  const prediction = predictMatch({
    ratingA: 1500,
    ratingB: 1500,
    modelConfig: {
      variant: "elo-poisson",
      experimentalModifiersEnabled: true,
      modifierEloDeltaLimit: 80,
      modifierXgDeltaLimit: 0.4,
      modifierXgMultiplierMin: 0.75,
      modifierXgMultiplierMax: 1.25,
    },
    contextModifiers: {
      weather: [
        {
          target: "both",
          adjustments: { eloDelta: 500, xgDelta: -5, xgMultiplier: 0.1 },
          explanation: "Synthetic severe-weather stress test with oversized requested adjustments.",
          provenance: { source: "unit-test", sourceId: "bounds-weather" },
        },
      ],
      suspension: [
        {
          target: "teamB",
          adjustments: { eloDelta: -500, xgMultiplier: 5 },
          explanation: "Synthetic suspension stress test with oversized requested adjustments.",
          provenance: { source: "unit-test", sourceId: "bounds-suspension" },
        },
      ],
    },
  });
  const weather = prediction.modifiers.applied.find((modifier) => modifier.kind === "weather");
  const suspension = prediction.modifiers.applied.find((modifier) => modifier.kind === "suspension");
  const total =
    prediction.probabilities.pWinA + prediction.probabilities.pDraw + prediction.probabilities.pWinB;

  assert.ok(weather);
  assert.ok(suspension);
  assert.equal(weather.appliedAdjustment.eloDelta, 80);
  assert.equal(weather.appliedAdjustment.xgDelta, -0.4);
  assert.equal(weather.appliedAdjustment.xgMultiplier, 0.75);
  assert.equal(suspension.appliedAdjustment.eloDelta, -80);
  assert.equal(suspension.appliedAdjustment.xgMultiplier, 1.25);
  assert.ok(prediction.xgA >= 0.05);
  assert.ok(prediction.xgB >= 0.05);
  assert.ok(Math.abs(total - 1) < 1e-12);
});
