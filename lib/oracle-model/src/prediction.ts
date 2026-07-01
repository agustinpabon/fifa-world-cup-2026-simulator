import {
  createModelConfig,
  usesDixonColes,
  usesStrengthMetrics,
  type ModelConfig,
  type ModelVariant,
} from "./config.js";
import { applyMatchContextModifiers } from "./modifiers.js";
import { expectedEloScore } from "./ratings.js";
import {
  type MatchContextModifiers,
  type MatchContextModifiersReport,
  type MatchPrediction,
  type OutcomeProbabilities,
  OUTCOMES,
  type ScoreProbability,
  type TeamStrengthMetrics,
} from "./types.js";

export type Rng = () => number;

export interface MatchPredictionInput {
  ratingA: number;
  ratingB: number;
  metricsA?: TeamStrengthMetrics;
  metricsB?: TeamStrengthMetrics;
  neutral?: boolean;
  isHomeA?: boolean;
  isHomeB?: boolean;
  modelConfig?: Partial<ModelConfig>;
  variant?: ModelVariant;
  contextModifiers?: MatchContextModifiers;
}

export interface ExpectedGoalsInput extends MatchPredictionInput {
  useStrengthMetrics?: boolean;
}

interface ExpectedGoalsResult {
  xgA: number;
  xgB: number;
  modifiers: MatchContextModifiersReport;
}

export function predictMatch(input: MatchPredictionInput): MatchPrediction {
  const config = createModelConfig({
    ...input.modelConfig,
    ...(input.variant ? { variant: input.variant } : {}),
  });
  const useStrength = usesStrengthMetrics(config.variant);
  const { xgA, xgB, modifiers } = expectedGoalsWithModifiers({
    ...input,
    modelConfig: config,
    useStrengthMetrics: useStrength,
  });
  const baseMatrix = buildScoreProbabilityMatrix(xgA, xgB, {
    maxGoals: config.maxGoals,
    dixonColesRho: config.dixonColesRho,
    useDixonColes: usesDixonColes(config.variant),
  });
  const scoreMatrix =
    config.variant === "elo-baseline"
      ? reweightMatrixToOutcomeProbabilities(baseMatrix, eloOutcomeProbabilities(input, config))
      : baseMatrix;

  return summarizePrediction(scoreMatrix, modifiers);
}

export function sampleMatchScore(input: MatchPredictionInput, random: Rng): { goalsA: number; goalsB: number } {
  const prediction = predictMatch(input);
  const draw = random();
  let cumulative = 0;

  for (const cell of prediction.scoreMatrix) {
    cumulative += cell.probability;
    if (draw <= cumulative) {
      return { goalsA: cell.goalsA, goalsB: cell.goalsB };
    }
  }

  const last = prediction.scoreMatrix.at(-1);
  if (!last) {
    throw new Error("Cannot sample from an empty score matrix");
  }

  return { goalsA: last.goalsA, goalsB: last.goalsB };
}

export function outcomeProbabilitiesForVariant(input: MatchPredictionInput): OutcomeProbabilities {
  const prediction = predictMatch(input);

  return {
    home: prediction.probabilities.pWinA,
    draw: prediction.probabilities.pDraw,
    away: prediction.probabilities.pWinB,
  };
}

export function expectedGoals(input: ExpectedGoalsInput): { xgA: number; xgB: number } {
  const { xgA, xgB } = expectedGoalsWithModifiers(input);

  return { xgA, xgB };
}

function expectedGoalsWithModifiers(input: ExpectedGoalsInput): ExpectedGoalsResult {
  const config = createModelConfig(input.modelConfig);
  const modifiers = applyMatchContextModifiers(input.contextModifiers, config);
  const bothMarkedHome = input.isHomeA && input.isHomeB;
  const effectiveRatingA =
    input.ratingA +
    modifiers.aggregate.eloDeltaA +
    (input.neutral === false ? config.homeAdvantageElo : 0) +
    (input.isHomeA && !bothMarkedHome ? config.hostBoost : 0);
  const effectiveRatingB =
    input.ratingB +
    modifiers.aggregate.eloDeltaB +
    (input.isHomeB && !bothMarkedHome ? config.hostBoost : 0);
  const diff = (effectiveRatingA - effectiveRatingB) / config.eloScale;
  const ratio = Math.min(Math.max(Math.sqrt(Math.pow(10, diff)), 0.15), 6.5);
  const total = config.baseXg * 2;
  let xgA = (total * ratio) / (1 + ratio);
  let xgB = total - xgA;

  if (input.useStrengthMetrics && input.metricsA && input.metricsB) {
    xgA *= input.metricsA.attackStrength * input.metricsB.defenseStrength;
    xgB *= input.metricsB.attackStrength * input.metricsA.defenseStrength;
  }

  xgA = xgA * modifiers.aggregate.xgMultiplierA + modifiers.aggregate.xgDeltaA;
  xgB = xgB * modifiers.aggregate.xgMultiplierB + modifiers.aggregate.xgDeltaB;

  return { xgA: Math.max(0.05, xgA), xgB: Math.max(0.05, xgB), modifiers };
}

export function buildScoreProbabilityMatrix(
  xgA: number,
  xgB: number,
  options: {
    maxGoals?: number;
    dixonColesRho?: number;
    useDixonColes?: boolean;
  } = {}
): ScoreProbability[] {
  const config = createModelConfig({
    maxGoals: options.maxGoals,
    dixonColesRho: options.dixonColesRho,
  });
  const rawCells: ScoreProbability[] = [];
  let rawMass = 0;

  for (let goalsA = 0; goalsA <= config.maxGoals; goalsA += 1) {
    const probabilityA = poissonProbability(xgA, goalsA);

    for (let goalsB = 0; goalsB <= config.maxGoals; goalsB += 1) {
      const adjustment = options.useDixonColes
        ? dixonColesAdjustment(xgA, xgB, goalsA, goalsB, config.dixonColesRho)
        : 1;
      const rawProbability = Math.max(0, probabilityA * poissonProbability(xgB, goalsB) * adjustment);
      rawCells.push({ goalsA, goalsB, probability: rawProbability });
      rawMass += rawProbability;
    }
  }

  if (rawMass <= 0) {
    throw new Error("Score probability matrix has no probability mass");
  }

  return rawCells.map((cell) => ({
    ...cell,
    probability: cell.probability / rawMass,
  }));
}

export function dixonColesAdjustment(
  xgA: number,
  xgB: number,
  goalsA: number,
  goalsB: number,
  rho: number
): number {
  if (goalsA === 0 && goalsB === 0) return 1 - xgA * xgB * rho;
  if (goalsA === 1 && goalsB === 0) return 1 + xgB * rho;
  if (goalsA === 0 && goalsB === 1) return 1 + xgA * rho;
  if (goalsA === 1 && goalsB === 1) return 1 - rho;
  return 1;
}

export function normalizeOutcomeProbabilities(probabilities: OutcomeProbabilities): OutcomeProbabilities {
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

function eloOutcomeProbabilities(input: MatchPredictionInput, config: ModelConfig): OutcomeProbabilities {
  const modifiers = applyMatchContextModifiers(input.contextModifiers, config);
  const bothMarkedHome = input.isHomeA && input.isHomeB;
  const effectiveRatingA =
    input.ratingA +
    modifiers.aggregate.eloDeltaA +
    (input.neutral === false ? config.homeAdvantageElo : 0) +
    (input.isHomeA && !bothMarkedHome ? config.hostBoost : 0);
  const effectiveRatingB =
    input.ratingB +
    modifiers.aggregate.eloDeltaB +
    (input.isHomeB && !bothMarkedHome ? config.hostBoost : 0);
  const expectedA = expectedEloScore(effectiveRatingA, effectiveRatingB);
  const decisiveRate = 1 - config.drawRate;

  return normalizeOutcomeProbabilities({
    home: decisiveRate * expectedA,
    draw: config.drawRate,
    away: decisiveRate * (1 - expectedA),
  });
}

function reweightMatrixToOutcomeProbabilities(
  matrix: readonly ScoreProbability[],
  targetProbabilities: OutcomeProbabilities
): ScoreProbability[] {
  const current = sumOutcomeProbabilities(matrix);
  const ratios = {
    home: targetProbabilities.home / current.home,
    draw: targetProbabilities.draw / current.draw,
    away: targetProbabilities.away / current.away,
  };
  const adjusted = matrix.map((cell) => ({
    ...cell,
    probability: cell.probability * ratios[outcomeForScore(cell.goalsA, cell.goalsB)],
  }));
  const total = adjusted.reduce((sum, cell) => sum + cell.probability, 0);

  if (total <= 0) {
    throw new Error("Reweighted score probability matrix has no probability mass");
  }

  return adjusted.map((cell) => ({
    ...cell,
    probability: cell.probability / total,
  }));
}

function summarizePrediction(
  scoreMatrix: readonly ScoreProbability[],
  modifiers: MatchContextModifiersReport
): MatchPrediction {
  let pWinA = 0;
  let pDraw = 0;
  let pWinB = 0;
  let matrixXgA = 0;
  let matrixXgB = 0;
  let mostLikelyCell = scoreMatrix[0];

  if (!mostLikelyCell) {
    throw new Error("Cannot summarize an empty score matrix");
  }

  for (const cell of scoreMatrix) {
    matrixXgA += cell.goalsA * cell.probability;
    matrixXgB += cell.goalsB * cell.probability;

    if (cell.goalsA > cell.goalsB) {
      pWinA += cell.probability;
    } else if (cell.goalsA < cell.goalsB) {
      pWinB += cell.probability;
    } else {
      pDraw += cell.probability;
    }

    if (cell.probability > mostLikelyCell.probability) {
      mostLikelyCell = cell;
    }
  }

  return {
    probabilities: { pWinA, pDraw, pWinB },
    xgA: Math.round(matrixXgA * 100) / 100,
    xgB: Math.round(matrixXgB * 100) / 100,
    mostLikelyScore: `${mostLikelyCell.goalsA}-${mostLikelyCell.goalsB}`,
    scoreMatrix: [...scoreMatrix],
    modifiers,
  };
}

function sumOutcomeProbabilities(matrix: readonly ScoreProbability[]): OutcomeProbabilities {
  return matrix.reduce<OutcomeProbabilities>(
    (sum, cell) => ({
      ...sum,
      [outcomeForScore(cell.goalsA, cell.goalsB)]:
        sum[outcomeForScore(cell.goalsA, cell.goalsB)] + cell.probability,
    }),
    { home: 0, draw: 0, away: 0 }
  );
}

function outcomeForScore(goalsA: number, goalsB: number): keyof OutcomeProbabilities {
  if (goalsA > goalsB) return "home";
  if (goalsB > goalsA) return "away";
  return "draw";
}

function poissonProbability(lambda: number, goals: number): number {
  if (goals < 0 || !Number.isInteger(goals)) return 0;
  if (lambda <= 0) return goals === 0 ? 1 : 0;

  let probability = Math.exp(-lambda);
  for (let index = 1; index <= goals; index += 1) {
    probability *= lambda / index;
  }

  return probability;
}
