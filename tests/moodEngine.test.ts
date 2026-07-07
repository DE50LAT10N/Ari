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
  proactiveToMoodEvent,
  triggerToMoodEvent,
} from "../src/character/moodEngine/moodEvents";
import { classifyMood } from "../src/character/moodEngine/moodClassifier";
import {
  loadMoodEngineState,
  resetMoodEngineForTests,
  saveMoodEngineState,
} from "../src/character/moodEngine/moodEngineStore";
import { adaptMoodToStyle } from "../src/character/moodEngine/moodStyleAdapter";
import { deriveMoodPolicy } from "../src/character/moodEngine/moodPolicy";
import { INTERACTION_MOOD_SHIFTS } from "../src/character/mood";
import {
  getCurrentMoodLayers,
  loadMoodTimeline,
  resetMoodTimelineForTests,
  updateMoodFromEvents,
} from "../src/character/moodEngine";
import { defaultSettings } from "../src/settings/appSettings";

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
    resetMoodTimelineForTests();
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
    const expectedWarmth = Math.min(
      1,
      base.warmth +
        INTERACTION_MOOD_SHIFTS.headpat.warmth +
        INTERACTION_MOOD_SHIFTS.return.warmth,
    );
    expect(out.nextMood.warmth).toBeCloseTo(expectedWarmth, 4);
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

  it("reaches annoyed after a few ignored interactions", () => {
    const now = 1_000_000;
    let mood = createBaselineVector(DEFAULT_MOOD_AXES);
    for (let index = 0; index < 4; index += 1) {
      const out = updateMood({
        currentMood: mood,
        currentUpdatedAt: now,
        now,
        axisConfig: DEFAULT_MOOD_AXES,
        events: [interactionToMoodEvent({ interaction: "ignored_initiative", timestamp: now })],
        options: { applyDecay: false },
      });
      mood = out.nextMood;
    }
    const cls = classifyMood(mood, { now });
    expect(cls.emotion).toBe("annoyed");
  });

  it("reaches warm emotion after a few headpats", () => {
    const now = 1_000_000;
    let mood = createBaselineVector(DEFAULT_MOOD_AXES);
    for (let index = 0; index < 3; index += 1) {
      const out = updateMood({
        currentMood: mood,
        currentUpdatedAt: now,
        now,
        axisConfig: DEFAULT_MOOD_AXES,
        events: [interactionToMoodEvent({ interaction: "headpat", timestamp: now })],
        options: { applyDecay: false },
      });
      mood = out.nextMood;
    }
    const cls = classifyMood(mood, { now });
    expect(["happy", "blush", "empathetic", "shy", "proud"]).toContain(cls.emotion);
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

  it("derives policy knobs from mood vector", () => {
    const irritated = deriveMoodPolicy({
      warmth: 0,
      energy: 0.5,
      irritation: 0.8,
    });
    expect(irritated.replyLength).toBe("short");
    expect(irritated.sarcasm).toBeGreaterThan(0.55);
    expect(irritated.refusalSharpness).toBeGreaterThan(0.5);

    const playful = deriveMoodPolicy({
      warmth: 0.45,
      energy: 0.85,
      irritation: -0.2,
    });
    expect(playful.thoughtBubbleChance).toBeGreaterThan(
      irritated.thoughtBubbleChance,
    );
    expect(playful.preferredEmotions).toContain("amused");
  });

  it("style adapter exposes mood policy response params", () => {
    const style = adaptMoodToStyle({
      warmth: 0.45,
      energy: 0.85,
      irritation: -0.2,
    });
    expect(style.policy.thoughtBubbleChance).toBeGreaterThan(0.5);
    expect(style.responseParams.sarcasm).toBeTypeOf("number");
    expect(style.promptModifier).toContain("Mood policy");
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

  it("splits mood updates into reactive and baseline layers", () => {
    const now = 1_000_000;
    updateMoodFromEvents({
      settings: defaultSettings,
      now,
      events: [
        interactionToMoodEvent({
          interaction: "ignored_initiative",
          timestamp: now,
        }),
      ],
      options: { applyDecay: false },
    });

    const layers = getCurrentMoodLayers({ now });
    expect(layers.reactiveVector.irritation).toBeGreaterThan(
      layers.baselineVector.irritation,
    );
    expect(layers.vector.irritation).toBeGreaterThan(
      layers.baselineVector.irritation,
    );
  });

  it("reactive layer fades faster than baseline layer", () => {
    const now = 1_000_000;
    updateMoodFromEvents({
      settings: defaultSettings,
      now,
      events: [emotionToMoodEvent({ emotion: "happy", timestamp: now })],
      options: { applyDecay: false },
    });
    const afterEvent = getCurrentMoodLayers({ now });

    updateMoodFromEvents({
      settings: defaultSettings,
      now: now + 3 * 3_600_000,
      events: [],
    });
    const later = getCurrentMoodLayers({ now: now + 3 * 3_600_000 });
    const reactiveLiftNow =
      afterEvent.reactiveVector.warmth - DEFAULT_MOOD_AXES.warmth.baseline;
    const reactiveLiftLater =
      later.reactiveVector.warmth - DEFAULT_MOOD_AXES.warmth.baseline;
    const baselineLiftLater =
      later.baselineVector.warmth - DEFAULT_MOOD_AXES.warmth.baseline;

    expect(reactiveLiftLater).toBeLessThan(reactiveLiftNow);
    expect(baselineLiftLater).toBeGreaterThan(0);
  });

  it("records a mood timeline entry for persisted event updates", () => {
    const now = 1_000_000;
    updateMoodFromEvents({
      settings: defaultSettings,
      now,
      events: [emotionToMoodEvent({ emotion: "annoyed", timestamp: now })],
      options: { applyDecay: false },
    });

    const timeline = loadMoodTimeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].eventTypes).toContain("emotion");
    expect(timeline[0].eventSources).toContain("assistant_reply");
    expect(timeline[0].strongestAxis).toBeTruthy();
    expect(timeline[0].reason).toContain("emotion");
  });

  it("maps proactive advice feedback into mood events", () => {
    const now = 1_000_000;
    const base = createBaselineVector(DEFAULT_MOOD_AXES);
    const useful = updateMood({
      currentMood: base,
      currentUpdatedAt: now,
      now,
      axisConfig: DEFAULT_MOOD_AXES,
      events: [
        proactiveToMoodEvent({
          kind: "advice_feedback",
          tone: "advice",
          feedback: "useful",
          timestamp: now,
        }),
      ],
      options: { applyDecay: false },
    });
    const miss = updateMood({
      currentMood: base,
      currentUpdatedAt: now,
      now,
      axisConfig: DEFAULT_MOOD_AXES,
      events: [
        proactiveToMoodEvent({
          kind: "advice_feedback",
          tone: "advice",
          feedback: "miss",
          timestamp: now,
        }),
      ],
      options: { applyDecay: false },
    });

    expect(useful.nextMood.warmth).toBeGreaterThan(base.warmth);
    expect(useful.nextMood.irritation).toBeLessThan(base.irritation);
    expect(miss.nextMood.warmth).toBeLessThan(base.warmth);
    expect(miss.nextMood.irritation).toBeGreaterThan(base.irritation);
  });

  it("records proactive event kinds in mood timeline", () => {
    const now = 1_000_000;
    updateMoodFromEvents({
      settings: defaultSettings,
      now,
      events: [
        proactiveToMoodEvent({
          kind: "advice_ignored",
          tone: "advice",
          timestamp: now,
        }),
      ],
      options: { applyDecay: false },
    });

    const timeline = loadMoodTimeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].eventTypes).toContain("advice_ignored");
    expect(timeline[0].eventSources).toContain("proactive");
    expect(timeline[0].reason).toContain("advice_ignored");
  });

  it("does not record mood timeline entries for dry runs or empty decay ticks", () => {
    const now = 1_000_000;
    updateMoodFromEvents({
      settings: defaultSettings,
      now,
      events: [emotionToMoodEvent({ emotion: "happy", timestamp: now })],
      options: { dryRun: true },
    });
    updateMoodFromEvents({
      settings: defaultSettings,
      now: now + 1_000,
      events: [],
    });

    expect(loadMoodTimeline()).toHaveLength(0);
  });
});

