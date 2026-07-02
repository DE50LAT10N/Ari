import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";
import type { MoodVector } from "./moodVector";
import {
  clampVector,
  createBaselineVector,
  deserializeVector,
  serializeVector,
} from "./moodVector";
import type { MoodEvent } from "./moodEvents";
import { resolveImpactRule } from "./impactRules";
import type { MoodClassificationResult } from "./moodClassifier";
import { classifyMood } from "./moodClassifier";

export type AppliedMoodImpact = {
  eventId: string;
  axisId: string;
  rawImpact: number;
  scaledImpact: number;
  intensity: number;
  confidence: number;
  source: string;
  type: string;
};

export type MoodUpdateDebug = {
  now: number;
  previous: MoodVector;
  baseline: MoodVector;
  decayFactorByAxis: Record<string, number>;
  impacts: AppliedMoodImpact[];
  summedImpactByAxis: Record<string, number>;
  next: MoodVector;
  classification: MoodClassificationResult;
};

export type MoodUpdateResult = {
  nextMood: MoodVector;
  appliedImpacts: AppliedMoodImpact[];
  classification: MoodClassificationResult;
  debug: MoodUpdateDebug;
};

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value)
    ? value
    : fallback;
}

function computeDecayFactor(axis: { decayHours: number }, elapsedMs: number): number {
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  const decayHours = Math.max(0.01, axis.decayHours);
  return Math.exp(-hours / decayHours);
}

export function updateMood(input: {
  currentMood: MoodVector;
  events: MoodEvent[];
  axisConfig?: MoodAxisConfigTable;
  /** current mood timestamp (ms) for decay calculation */
  currentUpdatedAt: number;
  now: number;
  options?: {
    applyDecay?: boolean;
    dryRun?: boolean;
  };
}): MoodUpdateResult {
  const config = input.axisConfig ?? DEFAULT_MOOD_AXES;
  const applyDecay = input.options?.applyDecay !== false;

  const previous = clampVector(deserializeVector(input.currentMood, config), config);
  const baseline = createBaselineVector(config);

  const elapsedMs = Math.max(0, input.now - safeNumber(input.currentUpdatedAt, input.now));

  const decayFactorByAxis: Record<string, number> = {};
  const decayed: MoodVector = {};
  for (const axis of Object.values(config)) {
    const factor = applyDecay ? computeDecayFactor(axis, elapsedMs) : 1;
    decayFactorByAxis[axis.id] = factor;
    const prev = previous[axis.id] ?? axis.baseline;
    const base = baseline[axis.id] ?? axis.baseline;
    decayed[axis.id] = base + (prev - base) * factor;
  }

  const impacts: AppliedMoodImpact[] = [];
  const summedImpactByAxis: Record<string, number> = {};
  for (const axis of Object.values(config)) {
    summedImpactByAxis[axis.id] = 0;
  }

  for (const event of input.events ?? []) {
    const intensity = Math.max(0, safeNumber(event.intensity, 1));
    const confidence = Math.max(0, Math.min(1, safeNumber(event.confidence, 1)));
    const impactVector: MoodVector | undefined =
      event.impact ??
      (event.impactRuleId ? resolveImpactRule(event.impactRuleId) : undefined);
    if (!impactVector) {
      continue;
    }
    for (const axis of Object.values(config)) {
      const raw = safeNumber(impactVector[axis.id], 0);
      if (!raw) continue;
      const scaled = raw * intensity * confidence;
      summedImpactByAxis[axis.id] += scaled;
      impacts.push({
        eventId: event.id,
        axisId: axis.id,
        rawImpact: raw,
        scaledImpact: scaled,
        intensity,
        confidence,
        source: event.source,
        type: event.type,
      });
    }
  }

  const next: MoodVector = {};
  for (const axis of Object.values(config)) {
    next[axis.id] = decayed[axis.id] + (summedImpactByAxis[axis.id] ?? 0);
  }

  const nextClamped = clampVector(next, config);
  const classification = classifyMood(nextClamped, { axisConfig: config, now: input.now });

  return {
    nextMood: serializeVector(nextClamped, config),
    appliedImpacts: impacts,
    classification,
    debug: {
      now: input.now,
      previous,
      baseline,
      decayFactorByAxis,
      impacts,
      summedImpactByAxis,
      next: nextClamped,
      classification,
    },
  };
}

