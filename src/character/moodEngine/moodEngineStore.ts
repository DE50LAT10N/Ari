import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";
import type { MoodVector } from "./moodVector";
import {
  createBaselineVector,
  deserializeVector,
  serializeVector,
  toCharacterMood,
  fromCharacterMood,
} from "./moodVector";
import type { MoodClassificationResult } from "./moodClassifier";

const ENGINE_KEY = "desktop-character.ari-mood-engine.v2";
const LEGACY_KEY = "desktop-character.ari-mood.v1";

export type PersistedMoodEngineState = {
  version: 2;
  updatedAt: number;
  vector: MoodVector;
  lastClassification?: MoodClassificationResult;
};

let cache: PersistedMoodEngineState | null = null;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value)
    ? value
    : fallback;
}

export function loadMoodEngineState(
  now = Date.now(),
  axisConfig: MoodAxisConfigTable = DEFAULT_MOOD_AXES,
): PersistedMoodEngineState {
  if (cache) {
    return cache;
  }

  const baseline = createBaselineVector(axisConfig);
  const stored = readJson<Partial<PersistedMoodEngineState> | null>(ENGINE_KEY, null);
  if (stored?.version === 2 && stored.vector) {
    cache = {
      version: 2,
      updatedAt: safeTimestamp(stored.updatedAt, now),
      vector: deserializeVector(stored.vector, axisConfig),
      lastClassification: stored.lastClassification,
    };
    return cache;
  }

  // Migrate from legacy v1 mood if present (warmth/energy/irritation only).
  const legacy = readJson<Record<string, unknown> | null>(LEGACY_KEY, null);
  if (legacy && typeof legacy === "object") {
    const migratedVector = deserializeVector(
      {
        ...baseline,
        warmth: legacy.warmth,
        energy: legacy.energy,
        irritation: legacy.irritation,
      },
      axisConfig,
    );
    cache = {
      version: 2,
      updatedAt: safeTimestamp(legacy.updatedAt, now),
      vector: migratedVector,
    };
    // Write v2 state for next time. Do not delete legacy key to avoid breaking old codepaths.
    saveMoodEngineState(cache, axisConfig);
    return cache;
  }

  cache = {
    version: 2,
    updatedAt: now,
    vector: baseline,
  };
  saveMoodEngineState(cache, axisConfig);
  return cache;
}

export function saveMoodEngineState(
  state: PersistedMoodEngineState,
  axisConfig: MoodAxisConfigTable = DEFAULT_MOOD_AXES,
): PersistedMoodEngineState {
  const stable: PersistedMoodEngineState = {
    version: 2,
    updatedAt: safeTimestamp(state.updatedAt, Date.now()),
    vector: serializeVector(state.vector, axisConfig),
    lastClassification: state.lastClassification,
  };
  cache = stable;
  localStorage.setItem(ENGINE_KEY, JSON.stringify(stable));
  return stable;
}

export function resetMoodEngineForTests(): void {
  cache = null;
  localStorage.removeItem(ENGINE_KEY);
}

export function persistLegacyMoodSnapshot(
  vector: MoodVector,
  updatedAt: number,
  axisConfig: MoodAxisConfigTable = DEFAULT_MOOD_AXES,
): void {
  // Keep legacy consumers working by writing the v1 shape.
  const mood = toCharacterMood(vector, updatedAt, axisConfig);
  localStorage.setItem(LEGACY_KEY, JSON.stringify(mood));
}

export function readLegacyMoodSnapshot(
  now = Date.now(),
  axisConfig: MoodAxisConfigTable = DEFAULT_MOOD_AXES,
): { updatedAt: number; vector: MoodVector } {
  const baseline = createBaselineVector(axisConfig);
  const legacy = readJson<Record<string, unknown> | null>(LEGACY_KEY, null);
  if (!legacy) {
    return { updatedAt: now, vector: baseline };
  }
  const vector = deserializeVector(
    {
      ...baseline,
      warmth: legacy.warmth,
      energy: legacy.energy,
      irritation: legacy.irritation,
    },
    axisConfig,
  );
  return { updatedAt: safeTimestamp(legacy.updatedAt, now), vector };
}

export function convertLegacyMoodToVector(
  mood: import("../mood").CharacterMood,
  axisConfig: MoodAxisConfigTable = DEFAULT_MOOD_AXES,
): MoodVector {
  return fromCharacterMood(mood, axisConfig);
}

