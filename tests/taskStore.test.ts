import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTask,
  completeTask,
  confirmProposedTask,
  dismissTask,
  getDueTasks,
  getNextTask,
  invalidateTaskCache,
  loadTasks,
  selectOpenTaskContext,
  snoozeTask,
} from "../src/tasks/taskStore";

const STORAGE_KEY = "desktop-character.tasks.v1";

function setupStorage(): Map<string, string> {
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
  return storage;
}

describe("taskStore", () => {
  beforeEach(() => {
    setupStorage();
    invalidateTaskCache();
  });

  it("transitions proposed task to open on confirm", () => {
    const proposed = addTask({
      title: "Review PR",
      kind: "task",
      status: "proposed",
      priority: "normal",
      source: "proposed",
    });
    const confirmed = confirmProposedTask(proposed.id);
    expect(confirmed?.status).toBe("open");
    expect(loadTasks({ status: "open" })).toHaveLength(1);
  });

  it("completes and dismisses tasks", () => {
    const task = addTask({
      title: "Ship feature",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });
    completeTask(task.id);
    expect(loadTasks({ status: "done", includeDone: true })[0]?.status).toBe(
      "done",
    );

    const proposed = addTask({
      title: "Noise",
      kind: "task",
      status: "proposed",
      priority: "low",
      source: "proposed",
    });
    dismissTask(proposed.id);
    expect(
      loadTasks({ status: "dismissed", includeDone: true })[0]?.status,
    ).toBe("dismissed");
  });

  it("returns due tasks and respects reminded state", () => {
    const past = Date.now() - 60_000;
    addTask({
      title: "Due now",
      kind: "reminder",
      status: "open",
      priority: "high",
      source: "user",
      dueAt: past,
      reminderState: "scheduled",
    });
    addTask({
      title: "Already reminded",
      kind: "reminder",
      status: "open",
      priority: "normal",
      source: "user",
      dueAt: past,
      reminderState: "reminded",
    });
    expect(getDueTasks().map((task) => task.title)).toEqual(["Due now"]);
  });

  it("snoozes open tasks with a new due time", () => {
    const task = addTask({
      title: "Later",
      kind: "reminder",
      status: "open",
      priority: "normal",
      source: "user",
      dueAt: Date.now() - 1000,
    });
    const snoozed = snoozeTask(task.id, 30 * 60_000);
    expect(snoozed?.reminderState).toBe("snoozed");
    expect(snoozed?.dueAt).toBeGreaterThan(Date.now());
    expect(getDueTasks()).toHaveLength(0);
  });

  it("picks next task by priority then due date", () => {
    addTask({
      title: "Low",
      kind: "task",
      status: "open",
      priority: "low",
      source: "user",
    });
    addTask({
      title: "High",
      kind: "task",
      status: "open",
      priority: "high",
      source: "user",
    });
    expect(getNextTask()?.title).toBe("High");
  });

  it("selects lexical task context for a query", () => {
    addTask({
      title: "Fix pomodoro timer",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
      notes: "break phase skips",
    });
    addTask({
      title: "Buy groceries",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });
    const matches = selectOpenTaskContext("pomodoro break");
    expect(matches[0]?.title).toContain("pomodoro");
  });

  it("persists tasks in localStorage", () => {
    const storage = setupStorage();
    addTask({
      title: "Persist me",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });
    invalidateTaskCache();
    expect(JSON.parse(storage.get(STORAGE_KEY) ?? "[]")).toHaveLength(1);
  });
});
