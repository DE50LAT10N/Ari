import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyInteractionToMood, loadMood, saveMood } from "../src/character/mood";
import { biasEmotionByMood } from "../src/character/emotionPresentation";
import {
  getDailyInitiativeKindCount,
  isDailyKindCapReached,
  markInitiativeSent,
} from "../src/character/initiativeScoring";
import { dailyInitiativeKindCap } from "../src/character/initiativeConfig";
import { defaultSettings } from "../src/settings/appSettings";
import { resolveScenario } from "../src/character/scenarioEngine";
import { pickPackReaction } from "../src/character/scenarioPacks";

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
}

describe("character depth", () => {
  beforeEach(() => {
    setupStorage();
    saveMood({
      warmth: 0.4,
      energy: 0.45,
      irritation: 0.1,
      updatedAt: Date.now(),
    });
  });

  it("uses midday copy in first_message_today", () => {
    const outcome = resolveScenario("first_message_today", {
      scenario: "first_message_today",
      scene: "focus",
      hour: 13,
      idleSeconds: 0,
      chatOpen: false,
      characterState: "idle",
      ritual: "midday",
      ritualTone: "середина дня — короткий чек-ин",
    });

    expect(outcome.kind).toBe("initiative");
    if (outcome.kind === "initiative") {
      expect(outcome.description).toContain("Полуденный");
      expect(outcome.description).toContain("середина дня");
    }
  });

  it("shifts mood on new interaction types", () => {
    const base = loadMood();
    const positive = applyInteractionToMood(base, "chat_positive");
    expect(positive.warmth).toBeGreaterThan(base.warmth);

    const ignored = applyInteractionToMood(base, "ignored_initiative");
    expect(ignored.irritation).toBeGreaterThan(base.irritation);

    const silent = applyInteractionToMood(base, "long_silence");
    expect(silent.energy).toBeLessThan(base.energy);
  });

  it("biases low energy toward sleepy and bored emotions", () => {
    const tired = {
      warmth: 0.4,
      energy: 0.2,
      irritation: 0.1,
      updatedAt: Date.now(),
    };
    expect(biasEmotionByMood("happy", tired)).toBe("calm");
    expect(biasEmotionByMood("neutral", { ...tired, energy: 0.25 })).toBe(
      "sleepy",
    );
    expect(biasEmotionByMood("neutral", { ...tired, energy: 0.18 })).toBe(
      "bored",
    );
  });

  it("tracks per-kind daily initiative counts without a practical cap", () => {
    const cap = dailyInitiativeKindCap("memory_callback", defaultSettings);
    expect(cap).toBeGreaterThan(100);
    markInitiativeSent(undefined, false, "memory_callback");
    expect(getDailyInitiativeKindCount("memory_callback")).toBe(1);
    expect(isDailyKindCapReached("memory_callback", cap)).toBe(false);
  });

  it("randomizes pack reactions among eligible entries", () => {
    localStorage.setItem(
      "desktop-character.scenario-packs.v1",
      JSON.stringify({ default: true }),
    );
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      localStorage.setItem("desktop-character.scenario-pack-cooldowns.v1", "{}");
      const reaction = pickPackReaction({
        scenario: "long_silence",
        scene: "focus",
        hour: 14,
        focusSessionActive: false,
      });
      if (reaction) {
        seen.add(reaction.line);
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
