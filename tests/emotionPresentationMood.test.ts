import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emotionConflictsWithMood,
  mergeReplyEmotionWithMood,
} from "../src/character/emotionPresentation";
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

function irritatedMood(): CharacterMood {
  return {
    warmth: 0.2,
    energy: 0.4,
    irritation: 0.5,
    updatedAt: Date.now(),
  };
}

describe("emotionPresentation mood sync", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("detects conflict between amused sprite and irritated mood", () => {
    expect(emotionConflictsWithMood("amused", irritatedMood())).toBe(true);
  });

  it("maps irritated archetype to annoyed avatar", () => {
    expect(mergeReplyEmotionWithMood("curious", irritatedMood())).toBe("annoyed");
    expect(mergeReplyEmotionWithMood("amused", irritatedMood())).toBe("annoyed");
  });

  it("keeps aligned reply emotion when not irritated", () => {
    const calmMood: CharacterMood = {
      warmth: 0.45,
      energy: 0.45,
      irritation: 0.05,
      updatedAt: Date.now(),
    };
    expect(mergeReplyEmotionWithMood("curious", calmMood)).toBe("curious");
  });
});
