import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAdviceTopicKey,
  describeAdviceMemoryForPrompt,
  loadAdviceLedger,
  loadAdviceTopicState,
  refreshAdviceTopicState,
  rememberAdviceSent,
  resetAdviceLedgerForTests,
  updateAdviceFeedback,
} from "../src/character/adviceLedger";

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
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
}

describe("adviceLedger", () => {
  beforeEach(() => {
    setupStorage();
    resetAdviceLedgerForTests();
  });

  it("keeps a stable current-topic key and refreshes state", () => {
    const first = refreshAdviceTopicState({
      anchor: "ChatPanel.tsx",
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      signalSummary: "old summary",
    }, 1_000);
    const secondKey = buildAdviceTopicKey({
      anchor: "ChatPanel.tsx",
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      signalSummary: "new summary with different details",
    });

    expect(secondKey).toBe(first.key);
    expect(loadAdviceTopicState(2_000)?.key).toBe(first.key);
    expect(loadAdviceTopicState(40 * 60_000)).toBeNull();
  });

  it("stores feedback and prunes expired advice", () => {
    const entry = rememberAdviceSent({
      messageId: "msg-1",
      anchor: "ChatPanel.tsx",
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      tone: "advice",
      replyText: "Проверь импорт в ChatPanel.tsx.",
    }, 1_000);

    const updated = updateAdviceFeedback(entry.id, "too_generic", 2_000);
    expect(updated?.feedback).toBe("too_generic");
    expect(describeAdviceMemoryForPrompt(entry.topicKey, 3_000)).toMatch(
      /слишком общо/i,
    );
    expect(loadAdviceLedger(37 * 60 * 60_000)).toEqual([]);
  });
});
