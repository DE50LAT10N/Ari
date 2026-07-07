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
    const mood: CharacterMood = {
      warmth: 0.2,
      energy: 0.55,
      irritation: 0.5,
      updatedAt: Date.now(),
    };
    expect(deriveMoodArchetype(mood)).toBe("irritated");
    expect(avatarEmotionFromMood(mood)).toBe("annoyed");
  });
});
