export const MODEL_VARIANTS = [
  "elo-baseline",
  "elo-poisson",
  "elo-poisson-dixon-coles",
  "elo-poisson-strength",
] as const;

export type ModelVariant = (typeof MODEL_VARIANTS)[number];

export const DEFAULT_MARGIN_OF_VICTORY_ELO_SCALING_CONSTANT = 2200;

export interface ModelConfig {
  variant: ModelVariant;
  initialRating: number;
  fallbackRating: number;
  ratingCenter: number;
  homeAdvantageElo: number;
  useMarginOfVictoryElo: boolean;
  marginOfVictoryEloScalingConstant: number;
  hostBoost: number;
  baseXg: number;
  eloScale: number;
  maxGoals: number;
  dixonColesRho: number;
  drawRate: number;
  recentMetricWindowYears: number;
  recentMetricHalfLifeYears: number;
  goalsPerTeamBaseline: number;
  maxRecentGoalBlend: number;
  recentMetricPriorWeight: number;
  metricEloScale: number;
  strengthMin: number;
  strengthMax: number;
}

export const ACTIVE_MODEL_VARIANT: ModelVariant = "elo-poisson-strength";

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  variant: ACTIVE_MODEL_VARIANT,
  initialRating: 1500,
  fallbackRating: 1500,
  ratingCenter: 1500,
  homeAdvantageElo: 75,
  useMarginOfVictoryElo: true,
  marginOfVictoryEloScalingConstant: DEFAULT_MARGIN_OF_VICTORY_ELO_SCALING_CONSTANT,
  hostBoost: 50,
  baseXg: 1.25,
  eloScale: 400,
  maxGoals: 10,
  dixonColesRho: -0.06,
  drawRate: 0.27,
  recentMetricWindowYears: 8,
  recentMetricHalfLifeYears: 2.0,
  goalsPerTeamBaseline: 1.35,
  maxRecentGoalBlend: 0.1,
  recentMetricPriorWeight: 60,
  metricEloScale: 5000,
  strengthMin: 0.6,
  strengthMax: 1.5,
};

export function createModelConfig(overrides: Partial<ModelConfig> = {}): ModelConfig {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  ) as Partial<ModelConfig>;

  return { ...DEFAULT_MODEL_CONFIG, ...definedOverrides };
}

export function usesDixonColes(variant: ModelVariant): boolean {
  return variant === "elo-poisson-dixon-coles";
}

export function usesStrengthMetrics(variant: ModelVariant): boolean {
  return variant === "elo-poisson-strength";
}

export function describeModelVariant(variant: ModelVariant): string {
  switch (variant) {
    case "elo-baseline":
      return "Elo-only baseline with a smoothed historical draw rate.";
    case "elo-poisson":
      return "Elo ratings converted to independent Poisson score probabilities.";
    case "elo-poisson-dixon-coles":
      return "Elo-Poisson score probabilities with Dixon-Coles low-score adjustment.";
    case "elo-poisson-strength":
      return "Elo-Poisson probabilities with recent attack/defense multipliers.";
  }
}
