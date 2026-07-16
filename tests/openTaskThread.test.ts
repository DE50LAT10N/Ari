import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeOpenTaskThread,
  getOpenTaskThread,
  isExplicitTaskClose,
  isOpenTaskActive,
  openTaskThread,
  resetOpenTaskThreadForTests,
  syncOpenTaskThread,
} from "../src/character/openTaskThread";
import { classifyResponseMode } from "../src/character/responseModes";

const LEETCODE = `You are given two non-empty linked lists representing two non-negative integers. The digits are stored in reverse order, and each of their nodes contains a single digit. Add the two numbers and return the sum as a linked list.

Example 1:
Input: l1 = [2,4,3], l2 = [5,6,4]
Output: [7,0,8]
Constraints: The number of nodes in each linked list is in the range [1, 100].`;

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

describe("openTaskThread sticky state", () => {
  beforeEach(() => {
    setupStorage();
    resetOpenTaskThreadForTests();
  });

  it("opens on problem statement and keeps sticky for arbitrary step replies", () => {
    syncOpenTaskThread({
      lastUserMessage: `${LEETCODE}\nПомоги с решением`,
      history: [{ role: "user", content: `${LEETCODE}\nПомоги с решением` }],
    });
    expect(isOpenTaskActive()).toBe(true);
    expect(getOpenTaskThread()?.excerpt).toContain("linked lists");

    const history = [
      { role: "user", content: `${LEETCODE}\nПомоги с решением` },
      {
        role: "assistant",
        content: "Ок, классическая задачка. Как думаешь, с чего начнем?",
      },
      { role: "user", content: "С перевода числа в строку" },
    ];

    const state = syncOpenTaskThread({
      lastUserMessage: "С перевода числа в строку",
      history,
    });
    expect(state).not.toBeNull();
    expect(isOpenTaskActive()).toBe(true);

    // Sticky forces technical_help even when the step reply is not a continuation regex hit.
    expect(
      classifyResponseMode({
        message: "С перевода числа в строку",
        recentHistory: history,
        hasOpenTaskThread: true,
      }),
    ).toBe("technical_help");
  });

  it("closes only on explicit topic change", () => {
    openTaskThread(LEETCODE);
    expect(isOpenTaskActive()).toBe(true);
    expect(isExplicitTaskClose("Давай просто поговорим")).toBe(true);

    const closed = syncOpenTaskThread({
      lastUserMessage: "Давай просто поговорим",
      history: [
        { role: "user", content: LEETCODE },
        { role: "user", content: "Давай просто поговорим" },
      ],
    });
    expect(closed).toBeNull();
    expect(isOpenTaskActive()).toBe(false);
    expect(
      classifyResponseMode({
        message: "Давай просто поговорим",
        hasOpenTaskThread: false,
      }),
    ).not.toBe("technical_help");
  });

  it("recovers excerpt from history when storage is empty", () => {
    closeOpenTaskThread();
    const state = syncOpenTaskThread({
      lastUserMessage: "С перевода числа в строку",
      history: [
        { role: "user", content: LEETCODE },
        { role: "assistant", content: "С чего начнем?" },
        { role: "user", content: "С перевода числа в строку" },
      ],
    });
    expect(state?.excerpt).toContain("linked lists");
    expect(isOpenTaskActive()).toBe(true);
  });
});

describe("sticky task validation", () => {
  it("flags short non-substance replies when userPresentedTask", async () => {
    const { validateCharacterReply } = await import(
      "../src/character/responseValidation"
    );
    const result = validateCharacterReply(
      "О, снова за кодом сидишь, да? Помочь с чем-нибудь конкретным?",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        userPresentedTask: true,
        responseMode: "technical_help",
      },
    );
    expect(result.issues).toContain("task acknowledgement only");
  });

  it("allows substantive replies", async () => {
    const { validateCharacterReply } = await import(
      "../src/character/responseValidation"
    );
    const result = validateCharacterReply(
      "Строка тут лишняя: идём по узлам с переносом, складываем digit+digit+carry. Сложность O(n).",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        userPresentedTask: true,
        responseMode: "technical_help",
      },
    );
    expect(result.issues).not.toContain("task acknowledgement only");
  });
});
