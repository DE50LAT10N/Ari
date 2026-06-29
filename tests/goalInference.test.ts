import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../src/llm/llmClient", () => ({
  completeLlmJson: vi.fn(),
}));

import { completeLlmJson } from "../src/llm/llmClient";
import { defaultSettings } from "../src/settings/appSettings";
import {
  addGoal,
  invalidateGoalCache,
  loadGoals,
} from "../src/tasks/goalLedger";
import {
  addTask,
  completeTask,
  completeTaskWithGoalInference,
  invalidateTaskCache,
} from "../src/tasks/taskStore";

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

describe("goal inference for completed tasks", () => {
  beforeEach(() => {
    setupStorage();
    invalidateGoalCache();
    invalidateTaskCache();
    (completeLlmJson as Mock).mockReset();
  });

  it("uses local goal scoring instead of blindly updating the current goal", () => {
    const current = addGoal({ title: "Допилить Ari", current: true });
    const report = addGoal({ title: "Отчёт недели", current: false });
    const task = addTask({
      title: "Написать отчёт недели",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
      goalId: "",
    });

    completeTask(task.id);

    const goals = loadGoals();
    expect(goals.find((goal) => goal.id === report.id)?.progress).toBeGreaterThan(0);
    expect(goals.find((goal) => goal.id === current.id)?.progress).toBe(0);
  });

  it("lets the LLM override a stale current-goal link when completing a task", async () => {
    const current = addGoal({ title: "Допилить Ari", current: true });
    const report = addGoal({ title: "Отчёт недели", current: false });
    const task = addTask({
      title: "Собрать итоги недели",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
      goalId: current.id,
    });
    (completeLlmJson as Mock).mockResolvedValue({
      goalId: report.id,
      confidence: 0.88,
      reason: "task is about weekly report",
    });

    const completed = await completeTaskWithGoalInference(task.id, defaultSettings);

    expect(completed?.goalId).toBe(report.id);
    expect(completed?.metadata?.goalInferenceSource).toBe("llm");
    expect(loadGoals().find((goal) => goal.id === report.id)?.progress).toBeGreaterThan(0);
    expect(loadGoals().find((goal) => goal.id === current.id)?.progress).toBe(0);
  });
});
