import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addGoal,
  getCurrentGoal,
  invalidateGoalCache,
  loadGoals,
} from "../src/tasks/goalLedger";
import {
  addTask,
  completeTask,
  invalidateTaskCache,
  loadTasks,
} from "../src/tasks/taskStore";
import { tryHandleTaskChatCommand } from "../src/chat/taskChatParse";

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

describe("goalLedger", () => {
  beforeEach(() => {
    setupStorage();
    invalidateGoalCache();
    invalidateTaskCache();
  });

  it("creates a current goal from chat command", () => {
    const result = tryHandleTaskChatCommand("добавь цель Допилить Ari 20%");

    expect(result.handled).toBe(true);
    expect(getCurrentGoal()?.title).toBe("Допилить Ari");
    expect(getCurrentGoal()?.progress).toBe(20);
  });

  it("links new tasks to the current goal", () => {
    const goal = addGoal({ title: "Ship proactive advisor", current: true });
    addTask({
      title: "Проверить proactive e2e",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });

    expect(loadTasks({ status: "open" })[0]?.goalId).toBe(goal.id);
  });

  it("moves goal progress when a linked task is completed", () => {
    const goal = addGoal({ title: "Ship task system", current: true });
    const task = addTask({
      title: "Добавить ledger целей",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });

    completeTask(task.id);

    const updated = loadGoals()[0];
    expect(updated.id).toBe(goal.id);
    expect(updated.progress).toBeGreaterThan(0);
    expect(updated.lastFocus).toContain("ledger");
  });
});
