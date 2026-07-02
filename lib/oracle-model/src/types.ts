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

export type MatchContextModifierKind = "weather" | "availability" | "suspension" | "manual";

export type MatchContextModifierTarget = "teamA" | "teamB" | "both";

export interface MatchContextModifierProvenance {
  source: string;
  sourceId?: string;
  sourceUrl?: string;
  retrievedAt?: string;
  notes?: readonly string[];
}

export interface MatchContextModifierAdjustments {
  eloDelta?: number;
  xgDelta?: number;
  xgMultiplier?: number;
}

export interface BaseMatchContextModifier {
  target?: MatchContextModifierTarget;
  adjustments?: MatchContextModifierAdjustments;
  explanation: string;
  provenance: MatchContextModifierProvenance;
}

export interface WeatherMatchContextModifier extends BaseMatchContextModifier {
  condition?: string;
}

export interface AvailabilityMatchContextModifier extends BaseMatchContextModifier {
  playerCount?: number;
}

export interface SuspensionMatchContextModifier extends BaseMatchContextModifier {
  playerName?: string;
}

export interface ManualMatchContextModifier extends BaseMatchContextModifier {
  label?: string;
}

export interface MatchContextModifiers {
  weather?: readonly WeatherMatchContextModifier[];
  availability?: readonly AvailabilityMatchContextModifier[];
  suspension?: readonly SuspensionMatchContextModifier[];
  manual?: readonly ManualMatchContextModifier[];
}

export interface AppliedMatchContextModifier {
  kind: MatchContextModifierKind;
  target: MatchContextModifierTarget;
  explanation: string;
  provenance: MatchContextModifierProvenance;
  requestedAdjustment: Required<MatchContextModifierAdjustments>;
  appliedAdjustment: Required<MatchContextModifierAdjustments>;
}

export interface MatchContextModifierAggregate {
  eloDeltaA: number;
  eloDeltaB: number;
  xgDeltaA: number;
  xgDeltaB: number;
  xgMultiplierA: number;
  xgMultiplierB: number;
}

export interface MatchContextModifiersReport {
  enabled: boolean;
  applied: AppliedMatchContextModifier[];
  ignoredCount: number;
  disabledReason?: string;
  aggregate: MatchContextModifierAggregate;
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
  modifiers: MatchContextModifiersReport;
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
