import {
  type MetricSummary,
  type Outcome,
  type OutcomeProbabilities,
  OUTCOMES,
  type ScoredForecast,
} from "./types.js";

const EPSILON = 1e-15;

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

export function outcomeForScore(homeScore: number, awayScore: number): Outcome {
  if (homeScore > awayScore) return "home";
  if (awayScore > homeScore) return "away";
  return "draw";
}

export function predictedOutcome(probabilities: OutcomeProbabilities): Outcome {
  return OUTCOMES.reduce((best, outcome) =>
    probabilities[outcome] > probabilities[best] ? outcome : best
  );
}
