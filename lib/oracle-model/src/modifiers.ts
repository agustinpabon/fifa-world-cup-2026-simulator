import { createModelConfig, type ModelConfig } from "./config.js";
import {
  type AppliedMatchContextModifier,
  type BaseMatchContextModifier,
  type MatchContextModifierAggregate,
  type MatchContextModifierAdjustments,
  type MatchContextModifierKind,
  type MatchContextModifierProvenance,
  type MatchContextModifiers,
  type MatchContextModifiersReport,
  type MatchContextModifierTarget,
} from "./types.js";

const IDENTITY_AGGREGATE: MatchContextModifierAggregate = {
  eloDeltaA: 0,
  eloDeltaB: 0,
  xgDeltaA: 0,
  xgDeltaB: 0,
  xgMultiplierA: 1,
  xgMultiplierB: 1,
};

type ModifierEntry = {
  kind: MatchContextModifierKind;
  modifier: BaseMatchContextModifier;
};

interface ModifierLimits {
  eloDeltaLimit: number;
  xgDeltaLimit: number;
  xgMultiplierMin: number;
  xgMultiplierMax: number;
}

export function applyMatchContextModifiers(
  modifiers: MatchContextModifiers | undefined,
  configInput: Partial<ModelConfig> = {}
): MatchContextModifiersReport {
  const config = createModelConfig(configInput);
  const entries = flattenMatchContextModifiers(modifiers);

  if (!config.experimentalModifiersEnabled) {
    return {
      enabled: false,
      applied: [],
      ignoredCount: entries.length,
      disabledReason:
        "Experimental match context modifiers are disabled; set experimentalModifiersEnabled=true or pass an explicit query flag to evaluate them.",
      aggregate: { ...IDENTITY_AGGREGATE },
    };
  }

  const limits = normalizeModifierLimits(config);
  const applied = entries.map((entry) => applyModifierEntry(entry, limits));

  return {
    enabled: true,
    applied,
    ignoredCount: 0,
    aggregate: summarizeAppliedModifiers(applied),
  };
}

export function mirrorMatchContextModifiers(
  modifiers: MatchContextModifiers | undefined
): MatchContextModifiers | undefined {
  if (!modifiers) {
    return undefined;
  }

  return {
    ...(modifiers.weather
      ? { weather: modifiers.weather.map((modifier) => mirrorModifierTarget(modifier)) }
      : {}),
    ...(modifiers.availability
      ? { availability: modifiers.availability.map((modifier) => mirrorModifierTarget(modifier)) }
      : {}),
    ...(modifiers.suspension
      ? { suspension: modifiers.suspension.map((modifier) => mirrorModifierTarget(modifier)) }
      : {}),
    ...(modifiers.manual
      ? { manual: modifiers.manual.map((modifier) => mirrorModifierTarget(modifier)) }
      : {}),
  };
}

export function mirrorMatchContextModifiersReport(
  report: MatchContextModifiersReport
): MatchContextModifiersReport {
  return {
    ...report,
    applied: report.applied.map((modifier) => ({
      ...modifier,
      target: mirrorTarget(modifier.target),
    })),
    aggregate: {
      eloDeltaA: report.aggregate.eloDeltaB,
      eloDeltaB: report.aggregate.eloDeltaA,
      xgDeltaA: report.aggregate.xgDeltaB,
      xgDeltaB: report.aggregate.xgDeltaA,
      xgMultiplierA: report.aggregate.xgMultiplierB,
      xgMultiplierB: report.aggregate.xgMultiplierA,
    },
  };
}

function flattenMatchContextModifiers(modifiers: MatchContextModifiers | undefined): ModifierEntry[] {
  if (!modifiers) {
    return [];
  }

  return [
    ...toEntries("weather", modifiers.weather),
    ...toEntries("availability", modifiers.availability),
    ...toEntries("suspension", modifiers.suspension),
    ...toEntries("manual", modifiers.manual),
  ];
}

function toEntries(
  kind: MatchContextModifierKind,
  modifiers: readonly BaseMatchContextModifier[] | undefined
): ModifierEntry[] {
  return (modifiers ?? []).map((modifier) => ({ kind, modifier }));
}

function applyModifierEntry(
  entry: ModifierEntry,
  limits: ModifierLimits
): AppliedMatchContextModifier {
  const target = normalizeTarget(entry);
  const explanation = normalizeExplanation(entry);
  const provenance = normalizeProvenance(entry);
  const requestedAdjustment = normalizeAdjustments(entry.modifier.adjustments);
  const appliedAdjustment = clampAdjustments(requestedAdjustment, limits);

  return {
    kind: entry.kind,
    target,
    explanation,
    provenance,
    requestedAdjustment,
    appliedAdjustment,
  };
}

function summarizeAppliedModifiers(
  modifiers: readonly AppliedMatchContextModifier[]
): MatchContextModifierAggregate {
  return modifiers.reduce<MatchContextModifierAggregate>(
    (aggregate, modifier) => {
      const appliesToA = modifier.target === "teamA" || modifier.target === "both";
      const appliesToB = modifier.target === "teamB" || modifier.target === "both";

      return {
        eloDeltaA: aggregate.eloDeltaA + (appliesToA ? modifier.appliedAdjustment.eloDelta : 0),
        eloDeltaB: aggregate.eloDeltaB + (appliesToB ? modifier.appliedAdjustment.eloDelta : 0),
        xgDeltaA: aggregate.xgDeltaA + (appliesToA ? modifier.appliedAdjustment.xgDelta : 0),
        xgDeltaB: aggregate.xgDeltaB + (appliesToB ? modifier.appliedAdjustment.xgDelta : 0),
        xgMultiplierA:
          aggregate.xgMultiplierA * (appliesToA ? modifier.appliedAdjustment.xgMultiplier : 1),
        xgMultiplierB:
          aggregate.xgMultiplierB * (appliesToB ? modifier.appliedAdjustment.xgMultiplier : 1),
      };
    },
    { ...IDENTITY_AGGREGATE }
  );
}

function normalizeTarget(entry: ModifierEntry): MatchContextModifierTarget {
  if (entry.modifier.target && isModifierTarget(entry.modifier.target)) {
    return entry.modifier.target;
  }

  if (entry.modifier.target !== undefined) {
    throw new Error(`${entry.kind} modifier target must be teamA, teamB, or both`);
  }

  if (entry.kind === "weather") {
    return "both";
  }

  throw new Error(`${entry.kind} modifier requires a target`);
}

function normalizeExplanation(entry: ModifierEntry): string {
  if (typeof entry.modifier.explanation !== "string") {
    throw new Error(`${entry.kind} modifier requires a non-empty explanation`);
  }

  const explanation = entry.modifier.explanation.trim();

  if (explanation.length === 0) {
    throw new Error(`${entry.kind} modifier requires a non-empty explanation`);
  }

  return explanation;
}

function normalizeProvenance(entry: ModifierEntry): MatchContextModifierProvenance {
  const provenance = entry.modifier.provenance;

  if (
    !provenance ||
    typeof provenance.source !== "string" ||
    provenance.source.trim().length === 0
  ) {
    throw new Error(`${entry.kind} modifier requires provenance.source`);
  }

  return {
    source: provenance.source.trim(),
    ...(provenance.sourceId ? { sourceId: provenance.sourceId } : {}),
    ...(provenance.sourceUrl ? { sourceUrl: provenance.sourceUrl } : {}),
    ...(provenance.retrievedAt ? { retrievedAt: provenance.retrievedAt } : {}),
    ...(provenance.notes ? { notes: [...provenance.notes] } : {}),
  };
}

function isModifierTarget(value: unknown): value is MatchContextModifierTarget {
  return value === "teamA" || value === "teamB" || value === "both";
}

function normalizeAdjustments(
  adjustments: MatchContextModifierAdjustments | undefined
): Required<MatchContextModifierAdjustments> {
  return {
    eloDelta: normalizeFiniteAdjustment(adjustments?.eloDelta, "eloDelta", 0),
    xgDelta: normalizeFiniteAdjustment(adjustments?.xgDelta, "xgDelta", 0),
    xgMultiplier: normalizeFiniteAdjustment(adjustments?.xgMultiplier, "xgMultiplier", 1),
  };
}

function normalizeFiniteAdjustment(value: number | undefined, label: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value)) {
    throw new Error(`Modifier ${label} must be a finite number`);
  }

  return value;
}

function clampAdjustments(
  adjustments: Required<MatchContextModifierAdjustments>,
  limits: ModifierLimits
): Required<MatchContextModifierAdjustments> {
  return {
    eloDelta: clamp(adjustments.eloDelta, -limits.eloDeltaLimit, limits.eloDeltaLimit),
    xgDelta: clamp(adjustments.xgDelta, -limits.xgDeltaLimit, limits.xgDeltaLimit),
    xgMultiplier: clamp(adjustments.xgMultiplier, limits.xgMultiplierMin, limits.xgMultiplierMax),
  };
}

function normalizeModifierLimits(config: ModelConfig): ModifierLimits {
  assertPositiveFinite(config.modifierEloDeltaLimit, "modifierEloDeltaLimit");
  assertPositiveFinite(config.modifierXgDeltaLimit, "modifierXgDeltaLimit");
  assertPositiveFinite(config.modifierXgMultiplierMin, "modifierXgMultiplierMin");
  assertPositiveFinite(config.modifierXgMultiplierMax, "modifierXgMultiplierMax");

  if (config.modifierXgMultiplierMin > config.modifierXgMultiplierMax) {
    throw new Error("modifierXgMultiplierMin must be less than or equal to modifierXgMultiplierMax");
  }

  return {
    eloDeltaLimit: config.modifierEloDeltaLimit,
    xgDeltaLimit: config.modifierXgDeltaLimit,
    xgMultiplierMin: config.modifierXgMultiplierMin,
    xgMultiplierMax: config.modifierXgMultiplierMax,
  };
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
}

function mirrorModifierTarget<TModifier extends BaseMatchContextModifier>(modifier: TModifier): TModifier {
  return {
    ...modifier,
    ...(modifier.target ? { target: mirrorTarget(modifier.target) } : {}),
  };
}

function mirrorTarget(target: MatchContextModifierTarget): MatchContextModifierTarget {
  if (target === "teamA") return "teamB";
  if (target === "teamB") return "teamA";
  return "both";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
