import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MOOD_AXES } from "../src/character/moodEngine/axisConfig";
import {
  clampVector,
  createBaselineVector,
  deserializeVector,
} from "../src/character/moodEngine/moodVector";
import { updateMood } from "../src/character/moodEngine/moodUpdateEngine";
import {
  emotionToMoodEvent,
  interactionToMoodEvent,
  triggerToMoodEvent,
} from "../src/character/moodEngine/moodEvents";
import { classifyMood } from "../src/character/moodEngine/moodClassifier";
import {
  loadMoodEngineState,
  resetMoodEngineForTests,
  saveMoodEngineState,
} from "../src/character/moodEngine/moodEngineStore";
import { adaptMoodToStyle } from "../src/character/moodEngine/moodStyleAdapter";
import { INTERACTION_MOOD_SHIFTS } from "../src/character/mood";

function setupStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("moodEngine", () => {
  beforeEach(() => {
    setupStorage();
    resetMoodEngineForTests();
  });

  it("clamps and sanitizes NaN/Infinity/out-of-range", () => {
    const baseline = createBaselineVector(DEFAULT_MOOD_AXES);
    const vec = deserializeVector(
      { warmth: NaN, energy: Infinity, irritation: -999 },
      DEFAULT_MOOD_AXES,
    );
    expect(vec.warmth).toBe(baseline.warmth);
    expect(vec.energy).toBe(baseline.energy);
    expect(vec.irritation).toBe(-1);
  });

  it("decays toward baseline", () => {
    const baseline = createBaselineVector(DEFAULT_MOOD_AXES);
    const now = 1_000_000;
    const current = { warmth: 1, energy: 1, irritation: 1 };
    const out = updateMood({
      currentMood: current,
      currentUpdatedAt: now - 4 * 3_600_000,
      now,
      events: [],
      axisConfig: DEFAULT_MOOD_AXES,
    });
    expect(out.nextMood.warmth).toBeLessThan(1);
    expect(out.nextMood.energy).toBeLessThan(1);
    expect(out.nextMood.irritation).toBeLessThan(1);
    // still above baseline
    expect(out.nextMood.warmth).toBeGreaterThan(baseline.warmth);
  });

  it("applies one event with intensity and confidence scaling", () => {
    const now = 1_000_000;
    const out = updateMood({
      currentMood: createBaselineVector(DEFAULT_MOOD_AXES),
      currentUpdatedAt: now,
      now,
      axisConfig: DEFAULT_MOOD_AXES,
      events: [
        emotionToMoodEvent({
          emotion: "happy",
          timestamp: now,
          intensity: 1.5,
          confidence: 0.5,
        }),
      ],
      options: { applyDecay: false },
    });
    // happy shift warmth +0.22, scaled by 0.75 => +0.165
    expect(out.nextMood.warmth).toBeCloseTo(0.25 + 0.165, 4);
  });

  it("sums multiple events deterministically", () => {
    const now = 1_000_000;
    const base = createBaselineVector(DEFAULT_MOOD_AXES);
    const out = updateMood({
      currentMood: base,
      currentUpdatedAt: now,
      now,
      axisConfig: DEFAULT_MOOD_AXES,
      events: [
        interactionToMoodEvent({ interaction: "headpat", timestamp: now }),
        interactionToMoodEvent({ interaction: "return", timestamp: now }),
      ],
      options: { applyDecay: false },
    });
    expect(out.appliedImpacts.length).toBeGreaterThan(0);
    expect(out.nextMood.warmth).toBeCloseTo(
      base.warmth +
        INTERACTION_MOOD_SHIFTS.headpat.warmth +
        INTERACTION_MOOD_SHIFTS.return.warmth,
      4,
    );
  });

  it("ignores unknown event with no impact", () => {
    const now = 1_000_000;
    const base = createBaselineVector(DEFAULT_MOOD_AXES);
    const out = updateMood({
      currentMood: base,
      currentUpdatedAt: now,
      now,
      axisConfig: DEFAULT_MOOD_AXES,
      events: [
        {
          id: "unknown",
          type: "unknown",
          source: "system",
          intensity: 1,
          confidence: 1,
          timestamp: now,
        },
      ],
      options: { applyDecay: false },
    });
    expect(out.nextMood).toEqual(clampVector(base, DEFAULT_MOOD_AXES));
  });

  it("supports adding a new axis without changing update engine", () => {
    const axisConfig = {
      ...DEFAULT_MOOD_AXES,
      focus: { id: "focus", min: -1, max: 1, baseline: 0, decayHours: 2 },
    };
    const now = 1_000_000;
    const base = createBaselineVector(axisConfig);
    const out = updateMood({
      currentMood: { ...base, focus: 0.8 },
      currentUpdatedAt: now - 2 * 3_600_000,
      now,
      axisConfig,
      events: [],
    });
    expect(out.nextMood.focus).toBeLessThan(0.8);
  });

  it("classification has stable fallback", () => {
    const base = createBaselineVector(DEFAULT_MOOD_AXES);
    const cls = classifyMood(base, { now: 1_000_000 });
    expect(cls.emotion).toBeTruthy();
    expect(cls.archetype).toBeTruthy();
  });

  it("persistence migrates from legacy v1 mood", () => {
    const legacy = { warmth: 0.5, energy: 0.4, irritation: 0.1, updatedAt: 123 };
    localStorage.setItem("desktop-character.ari-mood.v1", JSON.stringify(legacy));
    const loaded = loadMoodEngineState(1_000_000);
    expect(loaded.vector.warmth).toBeCloseTo(0.5, 4);
    expect(loaded.updatedAt).toBe(123);
  });

  it("does not mutate input mood object", () => {
    const now = 1_000_000;
    const original = createBaselineVector(DEFAULT_MOOD_AXES);
    const snapshot = { ...original };
    updateMood({
      currentMood: original,
      currentUpdatedAt: now,
      now,
      axisConfig: DEFAULT_MOOD_AXES,
      events: [emotionToMoodEvent({ emotion: "annoyed", timestamp: now })],
      options: { applyDecay: false },
    });
    expect(original).toEqual(snapshot);
  });

  it("style adapter produces a compact prompt modifier", () => {
    const now = 1_000_000;
    const base = createBaselineVector(DEFAULT_MOOD_AXES);
    const style = adaptMoodToStyle(base, { now });
    expect(style.promptModifier.length).toBeGreaterThan(30);
    // Must not include any tool/safety override language.
    expect(/tool access|bypass|refusal policy/i.test(style.promptModifier)).toBe(false);
  });

  it("triggerToMoodEvent returns null on neutral/low confidence", () => {
    const event = triggerToMoodEvent({
      trigger: { kind: "neutral", confidence: 0.3 },
      timestamp: 1_000_000,
    });
    expect(event).toBeNull();
  });

  it("store roundtrip keeps vector", () => {
    saveMoodEngineState({
      version: 2,
      updatedAt: 10,
      vector: { warmth: 0.4, energy: 0.2, irritation: 0.1 },
    });
    const loaded = loadMoodEngineState(20);
    expect(loaded.vector.warmth).toBeCloseTo(0.4, 4);
  });
});

