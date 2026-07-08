import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rememberAdviceSent,
  loadAdviceLedger,
  resetAdviceLedgerForTests,
} from "../src/character/adviceLedger";
import {
  recordFeedbackSignal,
} from "../src/character/feedbackSignals";
import { buildAvoidPhrases } from "../src/character/avoidPhraseBuilder";
import { MESSAGE_REACTIONS } from "../src/character/messageReactions";
import { resetAdviceOutcomesForTests } from "../src/character/adviceOutcome";
import { resetReactionLearningForTests } from "../src/character/reactionLearning";
import { describeRelevanceRankerForDiagnostics, resetRelevanceRankerForTests } from "../src/character/relevanceRanker";
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
    clear: () => storage.clear(),
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
}

describe("feedbackSignals", () => {
  beforeEach(() => {
    setupStorage();
    resetAdviceLedgerForTests();
    resetAdviceOutcomesForTests();
    resetReactionLearningForTests();
    resetRelevanceRankerForTests();
    resetSelfMemoryForTests();
  });

  it("routes advice menu feedback to ledger, outcomes, ranker, and mood", () => {
    const entry = rememberAdviceSent({
      messageId: "msg-1",
      tone: "advice",
      adviceCandidateKind: "debug_next_step",
      practicalHook: "Check the imported helper before changing the caller.",
      replyText: "Check the imported helper before changing the caller.",
    }, 1_000);

    const result = recordFeedbackSignal({
      kind: "advice_feedback",
      adviceId: entry.id,
      feedback: "useful",
      source: "menu",
      timestamp: 2_000,
    });

    expect(loadAdviceLedger(3_000)[0]?.feedback).toBe("useful");
    expect(result.adviceEntry?.id).toBe(entry.id);
    expect(result.moodEvents[0]?.type).toBe("advice_feedback");
    expect(describeRelevanceRankerForDiagnostics().learnedEvents).toBe(1);
  });

  it("routes message reactions to selfMemory, advice feedback, and mood", () => {
    const entry = rememberAdviceSent({
      messageId: "msg-1",
      tone: "advice",
      adviceCandidateKind: "debug_next_step",
      replyText: "A compact concrete fix.",
    });

    const result = recordFeedbackSignal({
      kind: "message_reaction",
      emoji: MESSAGE_REACTIONS[0],
      message: {
        role: "assistant",
        content: "A compact concrete fix.",
        emotion: "happy",
        messageId: "msg-1",
        adviceId: entry.id,
      },
      timestamp: 4_000,
    });

    expect(result.selfMemory?.successfulInteractionPatterns.length).toBeGreaterThan(0);
    expect(result.adviceFeedback).toBe("useful");
    expect(loadAdviceLedger()[0]?.feedback).toBe("useful");
    expect(result.moodEvents.map((event) => event.type)).toEqual([
      "message_reaction",
      "advice_feedback",
    ]);
  });

  it("routes conversation exchange selfMemory updates through one signal", () => {
    const result = recordFeedbackSignal({
      kind: "conversation_exchange",
      userMessage: "thanks, this is better",
      assistantReply: "Short and useful.",
      emotion: "happy",
      currentSelfMemory: loadAriSelfMemory(),
    });

    expect(result.selfMemory).toBeDefined();
    expect(loadAriSelfMemory().updatedAt).toBe(result.selfMemory?.updatedAt);
  });

  it("feeds negative advice feedback into avoid phrases", () => {
    const entry = rememberAdviceSent({
      messageId: "msg-2",
      tone: "advice",
      replyText: "UNIQUE_BAD_ADVICE_PHRASE",
    });
    recordFeedbackSignal({
      kind: "advice_feedback",
      adviceId: entry.id,
      feedback: "too_generic",
      source: "menu",
    });

    expect(buildAvoidPhrases()).toContain("UNIQUE_BAD_ADVICE_PHRASE");
  });
});
