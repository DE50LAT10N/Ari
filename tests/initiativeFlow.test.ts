import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canEmitProactiveReply,
  deriveInterruptibility,
} from "../src/character/interruptibility";
import {
  getRecentIgnoredInitiativeCount,
  markInitiativeSent,
} from "../src/character/initiativeScoring";
import { tryHandleTaskChatCommand } from "../src/chat/taskChatParse";
import { invalidateTaskCache, loadTasks } from "../src/tasks/taskStore";

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
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("initiativeFlow", () => {
  beforeEach(() => {
    setupStorage();
    invalidateTaskCache();
  });

  it("lowers interruptibility after two ignored initiatives", () => {
    markInitiativeSent();
    markInitiativeSent();
    expect(getRecentIgnoredInitiativeCount()).toBe(2);

    const tier = deriveInterruptibility({
      lifecycle: "awake",
      focusSessionActive: false,
      bodyDoubling: false,
      pomodoroPhase: "idle",
      chatOpen: false,
      generationInProgress: false,
      quietModeActive: false,
      typingIdleSeconds: 120,
      recentIgnoredInitiatives: getRecentIgnoredInitiativeCount(),
    });
    expect(tier).toBe("low_priority_ok");
  });

  it("keeps normal interruptibility with no pending initiatives", () => {
    const tier = deriveInterruptibility({
      lifecycle: "awake",
      focusSessionActive: false,
      bodyDoubling: false,
      pomodoroPhase: "idle",
      chatOpen: false,
      generationInProgress: false,
      quietModeActive: false,
      typingIdleSeconds: 120,
      recentIgnoredInitiatives: 0,
    });
    expect(tier).toBe("normal");
  });

  it("blocks local companion lines during pomodoro focus", () => {
    const tier = deriveInterruptibility({
      lifecycle: "awake",
      focusSessionActive: true,
      bodyDoubling: false,
      pomodoroPhase: "focus",
      chatOpen: false,
      generationInProgress: false,
      quietModeActive: false,
      typingIdleSeconds: 120,
      recentIgnoredInitiatives: 0,
    });
    expect(canEmitProactiveReply(tier, "check_in")).toBe(false);
  });

  it("adds a task from natural chat phrasing", () => {
    const result = tryHandleTaskChatCommand("добавь задачу Проверить релиз");
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    const tasks = loadTasks({ status: "open" });
    expect(tasks.some((task) => task.title.includes("Проверить релиз"))).toBe(
      true,
    );
  });
});
