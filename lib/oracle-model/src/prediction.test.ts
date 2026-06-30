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
