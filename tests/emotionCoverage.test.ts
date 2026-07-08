import { beforeEach, describe, expect, it, vi } from "vitest";
import { characterEmotions, type CharacterEmotion } from "../src/types/character";
import { avatarEmotionFromMood } from "../src/character/moodBehavior";
import type { CharacterMood } from "../src/character/mood";
import { classifyMood } from "../src/character/moodEngine/moodClassifier";
import { listSilentReactionEmotions } from "../src/character/silentReactions";
import { PngCharacterRenderer } from "../src/character/characterRenderer";
import { emotionSpritePaths, stateSpritePaths } from "../src/character/emotionAssets";

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

function moodVector(
  warmth: number,
  energy: number,
  irritation: number,
): CharacterMood {
  return { warmth, energy, irritation, updatedAt: Date.now() };
}

function collectReachableAvatarEmotions(): Set<CharacterEmotion> {
  const seen = new Set<CharacterEmotion>(["neutral"]);
  for (const emotion of listSilentReactionEmotions()) {
    seen.add(emotion);
  }

  const samples = Array.from({ length: 25 }, (_, index) => 0.02 + index * 0.038);
  for (const warmth of samples) {
    for (const energy of samples) {
      for (const irritation of samples) {
        const vector = moodVector(warmth, energy, irritation);
        seen.add(avatarEmotionFromMood(vector));
        seen.add(classifyMood(vector).emotion);
      }
    }
  }
  return seen;
}

describe("emotion coverage", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("covers every emotion sprite through mood, reactions, or neutral thinking", () => {
    const reachable = collectReachableAvatarEmotions();
    const missing = characterEmotions.filter((emotion) => !reachable.has(emotion));
    expect(missing, `unreachable emotions: ${missing.join(", ")}`).toEqual([]);
  });

  it("exposes every emotion png through silent reaction pools", () => {
    const seen = new Set(listSilentReactionEmotions());

    for (const emotion of characterEmotions) {
      if (emotion === "neutral") continue;
      expect(seen.has(emotion), `silent reactions never pick ${emotion}`).toBe(true);
    }
  });

  it("uses neutral.png while thinking and idle.png while idle", () => {
    const renderer = new PngCharacterRenderer();
    expect(renderer.getAvatarPath("neutral", "idle", false)).toBe(stateSpritePaths.idle);
    expect(renderer.getAvatarPath("neutral", "thinking", false)).toBe(
      emotionSpritePaths.neutral,
    );
  });
});
