import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterMood } from "../src/character/mood";
import {
  describeMoodChatReplyGuidance,
  resolveMoodChatDisposition,
} from "../src/character/moodChatDisposition";

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

function mood(partial: Partial<CharacterMood>): CharacterMood {
  return {
    warmth: 0.25,
    energy: 0.45,
    irritation: 0,
    updatedAt: Date.now(),
    ...partial,
  };
}

describe("moodChatDisposition", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("does not replace irritated smalltalk with a canned reply", () => {
    const irritated = mood({ irritation: 0.72, warmth: 0.08, energy: 0.42 });
    const result = resolveMoodChatDisposition(irritated, "привет, как дела?");
    expect(result).toBeNull();
  });

  it("does not refuse technical help even when irritated", () => {
    const irritated = mood({ irritation: 0.72, warmth: 0.08, energy: 0.42 });
    expect(
      resolveMoodChatDisposition(
        irritated,
        "у меня ошибка компиляции typescript, что не так?",
      ),
    ).toBeNull();
  });

  it("does not refuse emotional support when gloomy", () => {
    const gloomy = mood({
      warmth: 0.05,
      energy: 0.3,
      irritation: 0.18,
    });
    expect(
      resolveMoodChatDisposition(gloomy, "мне сейчас тревожно, поддержи"),
    ).toBeNull();
  });

  it("does not replace playful light questions with a canned reply", () => {
    const playful = mood({ energy: 0.82, warmth: 0.48, irritation: 0.04 });
    const result = resolveMoodChatDisposition(playful, "почему ты такая?");
    expect(result).toBeNull();
  });

  it("keeps disposition disabled for the same mood and message", () => {
    const irritated = mood({ irritation: 0.65, warmth: 0.1, energy: 0.4 });
    const message = "расскажи что-нибудь интересное";
    const first = resolveMoodChatDisposition(irritated, message);
    const second = resolveMoodChatDisposition(irritated, message);
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("adds prompt guidance for irritated questions without permitting refusal", () => {
    const irritated = mood({ irritation: 0.55, warmth: 0.12, energy: 0.38 });
    const guidance = describeMoodChatReplyGuidance(
      irritated,
      "что думаешь про этот фильм?",
    );
    expect(guidance).toMatch(/answer through the LLM/i);
    expect(guidance).toMatch(/Do not refuse/i);
  });

  it("adds playful guidance without replacing the answer", () => {
    const playful = mood({ energy: 0.78, warmth: 0.5, irritation: 0.05 });
    const guidance = describeMoodChatReplyGuidance(playful, "угадай загадку");
    expect(guidance).toMatch(/joke must not replace the answer/i);
  });
});
