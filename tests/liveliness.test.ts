import { describe, expect, it, vi } from "vitest";
import {
  freshnessBonus,
  mixedRecallScore,
  overlapScore,
  queryWordSet,
} from "../src/memory/memoryScoring";
import {
  emotionSettleDelay,
  emotionTransitionPath,
} from "../src/character/emotionTransitions";
import { scoreInitiativeLocally } from "../src/character/initiativeScoring";

describe("memoryScoring", () => {
  it("scores overlapping recall text higher", () => {
    const words = queryWordSet("любит кофе утром");
    expect(overlapScore("пользователь любит кофе по утрам", words)).toBeGreaterThan(
      overlapScore("работает над проектом", words),
    );
  });

  it("applies freshness bonus for recent facts", () => {
    const now = Date.now();
    expect(freshnessBonus(now - 2 * 86_400_000, now)).toBeGreaterThan(
      freshnessBonus(now - 120 * 86_400_000, now),
    );
  });

  it("combines lexical and semantic recall", () => {
    const score = mixedRecallScore(3, 0.5);
    expect(score).toBeCloseTo(0.7, 2);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("emotionTransitions", () => {
  it("bridges annoyed to happy through calmer emotions", () => {
    const path = emotionTransitionPath("annoyed", "happy");
    expect(path).toContain("happy");
    expect(path.length).toBeGreaterThan(1);
    expect(emotionSettleDelay("annoyed")).toBeGreaterThan(0);
  });
});

describe("initiativeScoring", () => {
  it("suppresses low-value ambient initiative during focus", () => {
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

    const decision = scoreInitiativeLocally({
      description: "просто поздороваться",
      scene: "focus",
      chatClosedAgoMs: 120_000,
      userActivityAgoMs: 120_000,
      mood: {
        energy: 0.3,
        warmth: 0.5,
        irritation: 0.1,
        updatedAt: Date.now(),
      },
    });
    expect(decision.allowed).toBe(false);
  });
});
