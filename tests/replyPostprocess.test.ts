import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import { defaultSettings, type AppSettings } from "../src/settings/appSettings";
import type { ChatMessage } from "../src/types/chat";
import type { CharacterRelationship } from "../src/character/relationship";
import {
  loadAdviceLedger,
  resetAdviceLedgerForTests,
} from "../src/character/adviceLedger";
import {
  getRecentAdviceOutcomes,
  reconcilePendingAdviceOutcomes,
  resetAdviceOutcomesForTests,
} from "../src/character/adviceOutcome";
import {
  loadAriSelfMemory,
  resetSelfMemoryForTests,
  type AriSelfMemory,
} from "../src/character/selfMemory";
import { resetConversationMemoryForTests } from "../src/memory/conversationMemory";
import { runReplyPostprocess } from "../src/app/replyPostprocess";

const mocks = vi.hoisted(() => ({
  collectProactiveSignalFacts: vi.fn(),
  extractSafeAction: vi.fn(),
}));

vi.mock("../src/app/chatRuntimeLoaders", () => ({
  loadProactiveRuntime: vi.fn(async () => ({
    collectProactiveSignalFacts: mocks.collectProactiveSignalFacts,
  })),
  loadSafeActions: vi.fn(async () => ({
    extractSafeAction: mocks.extractSafeAction,
  })),
}));

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
    randomUUID: () => "test-id",
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...defaultSettings,
    userMemoryEnabled: false,
    safeActionsEnabled: false,
    soundsEnabled: false,
    ...overrides,
  };
}

function relationship(): CharacterRelationship {
  return {
    familiarity: 0.08,
    trust: 0.12,
    playfulness: 0.2,
    exchanges: 0,
    updatedAt: 1_000,
  };
}

function createHarness() {
  let history: ChatMessage[] = [
    { role: "user", content: "Спасибо, так лучше." },
    { role: "assistant", content: "", emotion: "neutral", messageId: "assistant-1" },
  ];
  let currentRelationship = relationship();
  let currentSelfMemory: AriSelfMemory = loadAriSelfMemory();
  const setHistory = vi.fn((update: SetStateAction<ChatMessage[]>) => {
    history =
      typeof update === "function"
        ? update(history)
        : update;
  });
  const setRelationship = vi.fn(
    (update: SetStateAction<CharacterRelationship>) => {
      currentRelationship =
        typeof update === "function"
          ? update(currentRelationship)
          : update;
    },
  );
  const setSelfMemory = vi.fn((update: SetStateAction<AriSelfMemory>) => {
    currentSelfMemory =
      typeof update === "function"
        ? update(currentSelfMemory)
        : update;
  });

  return {
    get history() {
      return history;
    },
    get relationship() {
      return currentRelationship;
    },
    get selfMemory() {
      return currentSelfMemory;
    },
    setHistory,
    setRelationship,
    setSelfMemory,
  };
}

describe("runReplyPostprocess", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    setupStorage();
    resetAdviceLedgerForTests();
    resetAdviceOutcomesForTests();
    resetSelfMemoryForTests();
    resetConversationMemoryForTests();
    vi.clearAllMocks();
    mocks.collectProactiveSignalFacts.mockReturnValue([]);
    mocks.extractSafeAction.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates advice ledger and outcome observation after proactive advice", async () => {
    const harness = createHarness();

    await runReplyPostprocess({
      assistantIndex: 1,
      assistantMessageId: "assistant-1",
      baseHistory: [{ role: "user", content: "Посмотри на задачу" }],
      options: {
        proactive: true,
        initiativeKind: "check_in",
        initiativeAnchor: "ChatPanel refactor",
        proactiveAdviceCandidateKind: "debug_next_step",
        proactiveSignalSummary: "ChatPanel is being split into hooks.",
      },
      settings: settings(),
      activeWindow: { processName: "Code.exe", title: "ChatPanel.tsx" },
      observedActiveWindow: { processName: "Code.exe", title: "ChatPanel.tsx" },
      finalReply: "Проверь перенос generateReply в hook и только потом чисти imports.",
      replyEmotion: "curious",
      proactiveReplyTone: "advice",
      responseMode: "technical_help",
      validation: { valid: true, issues: [] },
      lastUserMessage: "",
      setHistory: harness.setHistory,
      setRelationship: harness.setRelationship,
      setSelfMemory: harness.setSelfMemory,
      onMoodInteraction: vi.fn(),
      logError: vi.fn(),
      ariLog: vi.fn(),
    });

    const entry = loadAdviceLedger()[0];
    expect(entry?.messageId).toBe("assistant-1");
    expect(harness.history[1]?.adviceId).toBe(entry?.id);
    const reconciled = reconcilePendingAdviceOutcomes({
      afterState: {
        at: 46 * 60_000,
        topicKey: entry!.topicKey,
        factIds: [],
        factSummary: "",
        hasErrorSignal: false,
        stuckScore: 0,
        openTaskCount: 0,
        breakDue: false,
      },
      now: 46 * 60_000,
    });
    expect(reconciled.records[0]?.adviceId).toBe(entry?.id);
    expect(getRecentAdviceOutcomes(entry!.topicKey)[0]?.adviceId).toBe(entry?.id);
    expect(mocks.collectProactiveSignalFacts).toHaveBeenCalledTimes(1);
  });

  it("does not commit side effects for a stale generation", async () => {
    const harness = createHarness();

    await runReplyPostprocess({
      assistantIndex: 1,
      assistantMessageId: "assistant-stale",
      baseHistory: [{ role: "user", content: "Старый запрос" }],
      options: {},
      settings: settings({ userMemoryEnabled: true, safeActionsEnabled: true }),
      activeWindow: null,
      observedActiveWindow: null,
      finalReply: "Устаревший ответ",
      replyEmotion: "calm",
      responseMode: "direct_answer",
      validation: { valid: true, issues: [] },
      lastUserMessage: "Старый запрос",
      setHistory: harness.setHistory,
      setRelationship: harness.setRelationship,
      setSelfMemory: harness.setSelfMemory,
      isRunActive: () => false,
      logError: vi.fn(),
      ariLog: vi.fn(),
    });

    expect(harness.setHistory).not.toHaveBeenCalled();
    expect(harness.relationship.exchanges).toBe(0);
    expect(mocks.extractSafeAction).not.toHaveBeenCalled();
  });

  it("updates final message, relationship, and self memory for normal exchange", async () => {
    const harness = createHarness();
    const onMoodInteraction = vi.fn();

    await runReplyPostprocess({
      assistantIndex: 1,
      assistantMessageId: "assistant-1",
      baseHistory: [{ role: "user", content: "Спасибо, так лучше." }],
      options: {},
      settings: settings(),
      activeWindow: null,
      observedActiveWindow: null,
      finalReply: "Отлично, оставляю ответ коротким и по делу.",
      replyEmotion: "happy",
      responseMode: "casual",
      validation: { valid: true, issues: [] },
      lastUserMessage: "Спасибо, так лучше.",
      setHistory: harness.setHistory,
      setRelationship: harness.setRelationship,
      setSelfMemory: harness.setSelfMemory,
      onMoodInteraction,
      logError: vi.fn(),
      ariLog: vi.fn(),
    });

    expect(harness.history[1]?.content).toBe(
      "Отлично, оставляю ответ коротким и по делу.",
    );
    expect(harness.history[1]?.emotion).toBe("happy");
    expect(harness.relationship.exchanges).toBe(1);
    expect(harness.selfMemory.successfulInteractionPatterns.length).toBeGreaterThan(0);
    expect(onMoodInteraction).toHaveBeenCalledWith("chat_positive");
  });
});
