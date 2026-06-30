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

export type RatingMatchRow = HistoricalMatch;

export interface EloRatings {
  [teamName: string]: number;
}

export interface TeamStrengthMetrics {
  attackStrength: number;
  defenseStrength: number;
}

export interface TeamMetrics extends TeamStrengthMetrics {
  elo: number;
}

export interface RatingTeam {
  name: string;
  csvName: string;
}

export interface ScoreProbability {
  goalsA: number;
  goalsB: number;
  probability: number;
}

export interface MatchPrediction {
  probabilities: {
    pWinA: number;
    pDraw: number;
    pWinB: number;
  };
  xgA: number;
  xgB: number;
  mostLikelyScore: string;
  scoreMatrix: ScoreProbability[];
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
