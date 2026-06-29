import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdvisorContext } from "../src/character/advisorContext";
import {
  buildInitiativeSignalBundle,
  formatInitiativeContextForPrompt,
} from "../src/character/initiativeContext";
import { buildConversationTopics } from "../src/character/advisorEngine";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordFileFocus,
  recordQueryTopic,
} from "../src/memory/activitySignals";
import { invalidateGoalCache } from "../src/tasks/goalLedger";
import { addTask, invalidateTaskCache } from "../src/tasks/taskStore";

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

describe("task activity linking", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateGoalCache();
    invalidateTaskCache();
  });

  it("recognizes when recent activity matches an open task", () => {
    const now = Date.now();
    addTask({
      title: "Проверить Tauri active window permissions",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });
    recordQueryTopic({
      topic: "Tauri active window permissions",
      source: "browser",
      at: now,
    });

    const ctx = buildAdvisorContext(defaultSettings, {
      now,
      windowTitle: "activeWindow.ts - desktop-character - Cursor",
    });

    expect(ctx.taskActivityLink?.confidence).toBe("strong");
    expect(ctx.taskActivityLink?.shouldAsk).toBe(false);
    expect(ctx.taskActivityLink?.taskTitle).toContain("Tauri");
  });

  it("turns unclear activity into a conversation topic about the task link", () => {
    const now = Date.now();
    addTask({
      title: "Написать отчёт недели",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });
    recordFileFocus({
      process: "Code.exe",
      file: "activeWindow.ts",
      repo: "desktop-character",
      dwellMs: 4 * 60_000,
      at: now,
    });

    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      now,
      processName: "Code.exe",
      windowTitle: "activeWindow.ts - desktop-character - Cursor",
    });
    const topics = buildConversationTopics(bundle.advisor, 5, [], bundle);
    const formatted = formatInitiativeContextForPrompt(bundle);

    expect(bundle.taskActivityLink?.shouldAsk).toBe(true);
    expect(topics[0]).toMatch(/связ[ьи] активности с задачей/i);
    expect(topics.join(" ")).toMatch(/связ[ьи] активности с задачей/i);
    expect(formatted).toMatch(/Уточнить связь активности с задачей/i);
  });
});
