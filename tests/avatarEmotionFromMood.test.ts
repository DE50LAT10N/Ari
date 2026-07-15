import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  avatarEmotionFromMood,
  deriveMoodArchetype,
} from "../src/character/moodBehavior";
import type { CharacterMood } from "../src/character/mood";

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

describe("avatarEmotionFromMood", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("aligns irritated status archetype with annoyed sprite", () => {
    const irritated: CharacterMood = {
      warmth: 0.2,
      energy: 0.55,
      irritation: 0.65,
      updatedAt: Date.now(),
    };
    expect(deriveMoodArchetype(irritated)).toBe("irritated");
    expect(avatarEmotionFromMood(irritated)).toBe("annoyed");
  });

  it("uses classifier or preferred emotions beyond archetype fallback", () => {
    const playful: CharacterMood = {
      warmth: 0.35,
      energy: 0.68,
      irritation: 0.04,
      updatedAt: Date.now(),
    };
    const emotion = avatarEmotionFromMood(playful);
    expect(["amused", "curious", "happy", "excited", "surprised"]).toContain(emotion);
  });
});
