import type { CharacterMood } from "../mood";
import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";

export type MoodVector = Record<string, number>;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeAxisValue(
  raw: unknown,
  axis: { min: number; max: number; baseline: number },
): number {
  if (typeof raw !== "number" || Number.isNaN(raw) || !Number.isFinite(raw)) {
    return clamp(axis.baseline, axis.min, axis.max);
  }
  return clamp(raw, axis.min, axis.max);
}

export function createBaselineVector(config: MoodAxisConfigTable): MoodVector {
  const vector: MoodVector = {};
  for (const axis of Object.values(config)) {
    vector[axis.id] = clamp(axis.baseline, axis.min, axis.max);
  }
  return vector;
}

export function clampVector(vector: MoodVector, config: MoodAxisConfigTable): MoodVector {
  const next: MoodVector = {};
  for (const axis of Object.values(config)) {
    next[axis.id] = sanitizeAxisValue(vector[axis.id], axis);
  }
  return next;
}

export function deserializeVector(
  raw: unknown,
  config: MoodAxisConfigTable,
): MoodVector {
  const baseline = createBaselineVector(config);
  if (!raw || typeof raw !== "object") {
    return baseline;
  }
  const record = raw as Record<string, unknown>;
  const merged: MoodVector = { ...baseline };
  for (const axis of Object.values(config)) {
    merged[axis.id] = sanitizeAxisValue(record[axis.id], axis);
  }
  return merged;
}

export function serializeVector(vector: MoodVector, config: MoodAxisConfigTable): MoodVector {
  // Explicitly clamp and include only configured axes.
  return clampVector(vector, config);
}

export function fromCharacterMood(
  mood: CharacterMood,
  config: MoodAxisConfigTable = DEFAULT_MOOD_AXES,
): MoodVector {
  return clampVector(
    {
      warmth: mood.warmth,
      energy: mood.energy,
      irritation: mood.irritation,
    },
    config,
  );
}

export function toCharacterMood(
  vector: MoodVector,
  updatedAt: number,
  config: MoodAxisConfigTable = DEFAULT_MOOD_AXES,
): CharacterMood {
  const clamped = clampVector(vector, config);
  return {
    warmth: sanitizeAxisValue(clamped.warmth, config.warmth),
    energy: sanitizeAxisValue(clamped.energy, config.energy),
    irritation: sanitizeAxisValue(clamped.irritation, config.irritation),
    updatedAt,
  };
}

