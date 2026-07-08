import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeAllAssistantMessages,
  acknowledgeAssistantMessage,
  getInteractionAcknowledgementSummary,
  pruneIgnoredAssistantMessages,
  resetInteractionAcknowledgementForTests,
  trackAssistantMessageForAcknowledgement,
} from "../src/character/interactionAcknowledgement";

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
}

describe("interaction acknowledgement", () => {
  beforeEach(() => {
    setupStorage();
    resetInteractionAcknowledgementForTests();
  });

  it("turns an unacknowledged assistant message into an ignored signal", () => {
    trackAssistantMessageForAcknowledgement({
      message: {
        role: "assistant",
        content: "Ну и ладно.",
        messageId: "a1",
      },
      now: 1_000,
    });

    const ignored = pruneIgnoredAssistantMessages({
      now: 6 * 60_000 + 1_000,
      ignoreWindowMs: 5 * 60_000,
    });

    expect(ignored).toHaveLength(1);
    expect(ignored[0]).toMatchObject({
      kind: "assistant_ignored",
      messageId: "a1",
      ignoredStreak: 1,
      source: "chat",
    });
    expect(getInteractionAcknowledgementSummary().pending).toBe(0);
  });

  it("cancels pending ignore when the message is acknowledged", () => {
    trackAssistantMessageForAcknowledgement({
      message: {
        role: "assistant",
        content: "Ответ.",
        messageId: "a2",
      },
      now: 1_000,
    });

    expect(acknowledgeAssistantMessage("a2", 2_000)).toBe(true);
    expect(
      pruneIgnoredAssistantMessages({
        now: 10 * 60_000,
        ignoreWindowMs: 5 * 60_000,
      }),
    ).toEqual([]);
  });

  it("treats user reply as repair for all pending assistant messages", () => {
    trackAssistantMessageForAcknowledgement({
      message: {
        role: "assistant",
        content: "Первый.",
        messageId: "a3",
      },
      now: 1_000,
    });
    trackAssistantMessageForAcknowledgement({
      message: {
        role: "assistant",
        content: "Второй.",
        messageId: "a4",
      },
      now: 2_000,
    });

    expect(acknowledgeAllAssistantMessages(3_000)).toBe(2);
    expect(getInteractionAcknowledgementSummary(3_000)).toMatchObject({
      pending: 0,
      ignoredStreak: 0,
      lastRepairAt: 3_000,
    });
  });
});
