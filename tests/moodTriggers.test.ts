import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterMood } from "../src/character/mood";
import {
  classifyMoodTrigger,
  moodTriggerEmotionHint,
  previewMoodAfterTrigger,
} from "../src/character/moodTriggers";

function mood(partial: Partial<CharacterMood> = {}): CharacterMood {
  return {
    warmth: 0.25,
    energy: 0.45,
    irritation: 0,
    updatedAt: Date.now(),
    ...partial,
  };
}

describe("moodTriggers", () => {
  beforeEach(() => {
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
  });

  it("turns rude user wording into irritated mood pressure", () => {
    const trigger = classifyMoodTrigger("Ты бесишь, просто сделай нормально.");
    const next = previewMoodAfterTrigger(mood({ warmth: 0.3 }), trigger);

    expect(trigger.kind).toBe("rude");
    expect(next.irritation).toBeGreaterThan(0.25);
    expect(next.warmth).toBeLessThan(0.2);
    expect(moodTriggerEmotionHint(trigger)).toBe("annoyed");
  });

  it("turns playful banter into mischievous energy", () => {
    const trigger = classifyMoodTrigger("Хаха, ну ты даешь, ладно, смешно.");
    const next = previewMoodAfterTrigger(mood(), trigger);

    expect(trigger.kind).toBe("playful");
    expect(next.energy).toBeGreaterThan(0.55);
    expect(moodTriggerEmotionHint(trigger)).toBe("amused");
  });

  it("softens irritation after thanks or apology", () => {
    const thanks = classifyMoodTrigger("Спасибо, это помогло.");
    const apology = classifyMoodTrigger("Прости, я погорячился.");

    expect(previewMoodAfterTrigger(mood({ irritation: 0.3 }), thanks).irritation).toBeLessThan(0.25);
    expect(previewMoodAfterTrigger(mood({ irritation: 0.4 }), apology).irritation).toBeLessThan(0.25);
  });
});
