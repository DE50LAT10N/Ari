import { beforeEach, describe, expect, it, vi } from "vitest";
import { planAdvice } from "../src/character/advicePlanner";
import { scoreAdviceUrgency } from "../src/character/adviceUrgency";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import { collectProactiveSignalFacts } from "../src/character/proactiveLlmEngine";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordQueryTopic,
} from "../src/memory/activitySignals";
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

describe("advicePlanner", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateTaskCache();
  });

  it("selects debug_next_step for stacktrace and current file", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x at ChatPanel.tsx:42",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 8,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      urgency,
      sessionMinutes: 8,
    });

    const plan = planAdvice({ bundle, facts, urgency });

    expect(plan.selected?.kind).toBe("debug_next_step");
    expect(plan.selected?.evidenceIds.length).toBeGreaterThan(0);
    expect(plan.selected?.actionText).toMatch(/ChatPanel|ошиб|stack/i);
  });

  it("backs off weak advice after not-now feedback", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "notes.md - Ari - Cursor",
      sessionMinutes: 4,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 4,
    });

    const plan = planAdvice({
      bundle,
      facts,
      feedback: [
        {
          id: "old",
          at: 1,
          updatedAt: 1,
          expiresAt: Date.now() + 1_000,
          topicKey: "notes",
          feedback: "not_now",
        },
      ],
    });

    expect(plan.selected).toBeNull();
  });

  it("selects task_bridge for strong task/activity match", () => {
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
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      now,
      processName: "Cursor.exe",
      windowTitle: "activeWindow.ts - Ari - Cursor",
      sessionMinutes: 6,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 6,
    });

    const plan = planAdvice({ bundle, facts });

    expect(plan.selected?.kind).toBe("task_bridge");
    expect(plan.selected?.actionText).toMatch(/Tauri active window/i);
  });
});
