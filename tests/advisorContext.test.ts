import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdvisorContext } from "../src/character/advisorContext";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordFileFocus,
  recordQueryTopic,
} from "../src/memory/activitySignals";
import {
  invalidateTaskCache,
  addTask,
} from "../src/tasks/taskStore";
import {
  invalidateWorkingMemoryCache,
  recordWorkingEvent,
  pruneWorkingMemory,
} from "../src/memory/workingMemory";

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

describe("buildAdvisorContext", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateTaskCache();
    invalidateWorkingMemoryCache();
    pruneWorkingMemory();
  });

  it("derives breakDue from long session minutes", () => {
    const ctx = buildAdvisorContext(
      { ...defaultSettings, advisorEnabled: true },
      { sessionMinutes: 55, windowMinutes: 55 },
    );
    expect(ctx.breakDue).toBe(true);
  });

  it("derives contextThrash from rapid window switches", () => {
    const now = Date.now();
    for (let index = 0; index < 8; index += 1) {
      recordWorkingEvent({
        kind: "window_switch",
        app: `app-${index}`,
        topic: `switch ${index}`,
        at: now - index * 20_000,
      });
    }
    const ctx = buildAdvisorContext(defaultSettings, { now });
    expect(ctx.contextThrash).toBe(true);
  });

  it("derives stuckScore from repeated errors and long dwell", () => {
    const now = Date.now();
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "Error: boom\n at main.ts:1",
      at: now - 60_000,
    });
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "Error: boom\n at main.ts:1",
      at: now - 30_000,
    });
    recordFileFocus({
      process: "Code.exe",
      file: "main.ts",
      dwellMs: 50 * 60_000,
      at: now,
    });
    const ctx = buildAdvisorContext(defaultSettings, { now });
    expect(ctx.stuckScore).toBeGreaterThanOrEqual(0.45);
    expect(ctx.repeatedErrorSignature).toBeTruthy();
  });

  it("derives scopeCreep from many open tasks and churn", () => {
    for (let index = 0; index < 7; index += 1) {
      addTask({
        title: `Task ${index}`,
        kind: "task",
        status: "open",
        priority: "normal",
        source: "user",
      });
    }
    for (let index = 0; index < 6; index += 1) {
      recordWorkingEvent({
        kind: "window_switch",
        app: `app-${index}`,
        topic: `switch ${index}`,
      });
    }
    recordQueryTopic({ topic: "typescript generics", source: "chat" });
    const ctx = buildAdvisorContext(defaultSettings);
    expect(ctx.scopeCreep).toBe(true);
    expect(ctx.topQueryThemes).toContain("typescript generics");
  });
});
