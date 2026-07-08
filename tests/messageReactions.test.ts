import { describe, expect, it, beforeEach, vi } from "vitest";
import { reactionToMoodEvent } from "../src/character/moodEngine/moodEvents";
import {
  isValidMessageReaction,
  reactionSentiment,
} from "../src/character/messageReactions";
import {
  describeReactionLearningSummary,
  reactionToAdviceFeedback,
  recordReactionLearning,
  resetReactionLearningForTests,
} from "../src/character/reactionLearning";
import { loadAriSelfMemory, resetSelfMemoryForTests } from "../src/character/selfMemory";

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

describe("message reactions", () => {
  it("validates allowed emoji reactions", () => {
    expect(isValidMessageReaction("👍")).toBe(true);
    expect(isValidMessageReaction("🔥")).toBe(false);
  });

  it("maps reactions to sentiment buckets", () => {
    expect(reactionSentiment("❤️")).toBe("positive");
    expect(reactionSentiment("😮")).toBe("surprise");
    expect(reactionSentiment("😢")).toBe("sad");
    expect(reactionSentiment("👎")).toBe("negative");
  });
});

describe("reactionToMoodEvent", () => {
  it("returns ui_interaction mood event with emoji impact", () => {
    const event = reactionToMoodEvent({ emoji: "👍", messageId: "m1" });

    expect(event.type).toBe("message_reaction");
    expect(event.source).toBe("ui_interaction");
    expect(event.impact).toEqual({
      warmth: 0.14,
      energy: 0.06,
      irritation: -0.12,
    });
  });

  it("applies negative impact for thumbs down", () => {
    const event = reactionToMoodEvent({ emoji: "👎" });

    expect(event.impact?.irritation).toBeGreaterThan(0);
    expect(event.impact?.warmth).toBeLessThan(0);
  });
});

describe("reactionLearning", () => {
  beforeEach(() => {
    setupStorage();
    resetReactionLearningForTests();
    resetSelfMemoryForTests();
  });

  it("maps emoji to advice feedback", () => {
    expect(reactionToAdviceFeedback("👍")).toBe("useful");
    expect(reactionToAdviceFeedback("👎")).toBe("miss");
    expect(reactionToAdviceFeedback("😢")).toBe("not_now");
  });

  it("updates self memory from positive reactions", () => {
    const result = recordReactionLearning({
      emoji: "❤️",
      message: {
        role: "assistant",
        content: "Короткий тёплый ответ без лишних вопросов.",
        emotion: "warm",
      },
    });

    expect(
      result.selfMemory.successfulInteractionPatterns.some((item) =>
        item.includes("Короткий тёплый ответ"),
      ),
    ).toBe(true);
    expect(loadAriSelfMemory().successfulInteractionPatterns.length).toBeGreaterThan(0);
  });

  it("records disliked patterns from thumbs down", () => {
    const result = recordReactionLearning({
      emoji: "👎",
      message: {
        role: "assistant",
        content: "Хочешь обсудить что-то конкретное из документа?",
      },
    });

    expect(
      result.selfMemory.userDislikedBehaviors.some((item) =>
        item.includes("Хочешь обсудить"),
      ),
    ).toBe(true);
    expect(
      result.selfMemory.userDislikedBehaviors.some((item) =>
        item.includes("не заканчивать реплики вопросом"),
      ),
    ).toBe(true);
  });

  it("builds a reaction summary for prompts", () => {
    recordReactionLearning({
      emoji: "👎",
      message: {
        role: "assistant",
        content: "Слишком общий ответ без конкретики.",
      },
    });
    recordReactionLearning({
      emoji: "👎",
      message: {
        role: "assistant",
        content: "Ещё один неудачный ответ.",
      },
    });

    expect(describeReactionLearningSummary()).toMatch(/не заходило/i);
  });
});
