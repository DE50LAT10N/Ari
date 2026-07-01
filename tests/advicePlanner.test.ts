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

  it("selects docs_to_code_bridge when browser search relates to current file", () => {
    recordQueryTopic({
      topic: "ChatPanel proactive advice gate",
      source: "browser",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 8,
    });

    const plan = planAdvice({ bundle, facts });

    expect(plan.selected?.kind).toBe("docs_to_code_bridge");
    expect(plan.selected?.actionText).toMatch(/ChatPanel|поиск/i);
  });

  it("downranks a candidate kind that recently interrupted the user", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x at activeWindow.ts:42",
    });
    addTask({
      title: "Проверить activeWindow stacktrace",
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });
    recordQueryTopic({
      topic: "activeWindow stacktrace",
      source: "browser",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "activeWindow.ts - Ari - Cursor",
      sessionMinutes: 6,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 6,
    });

    const plan = planAdvice({
      bundle,
      facts,
      outcomes: [
        {
          adviceId: "old",
          topicKey: "activeWindow",
          candidateKind: "debug_next_step",
          beforeState: {
            at: 1,
            topicKey: "activeWindow",
            factIds: [],
            factSummary: "",
            hasErrorSignal: true,
            stuckScore: 0.5,
            openTaskCount: 1,
            breakDue: false,
          },
          outcome: "interrupted",
          confidence: 0.9,
          reason: "не вовремя",
          detectedAt: 2,
          expiresAt: Date.now() + 1_000,
        },
      ],
    });

    expect(plan.selected?.kind).toBe("clarifying_probe");
    expect(plan.selected?.actionText).toMatch(/activeWindow|буфер/i);
  });

  it("blocks repeated timebox refocus advice without explicit feedback", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "Cursor Agents - Ari - Cursor",
      sessionMinutes: 18,
    });
    const noisyBundle = {
      ...bundle,
      advisor: {
        ...bundle.advisor,
        contextThrash: true,
      },
    };
    const facts = [
      {
        id: "wm:cursor-agents",
        kind: "wm" as const,
        label: "Окно",
        detail: "Cursor Agents",
      },
    ];

    const repeated = planAdvice({
      bundle: noisyBundle,
      facts,
      feedback: [
        {
          id: "old-1",
          at: Date.now() - 10 * 60_000,
          updatedAt: Date.now() - 10 * 60_000,
          expiresAt: Date.now() + 60_000,
          topicKey: "cursor agents",
          adviceCandidateKind: "refocus",
          practicalHook:
            "Предлагаю выделить 10 минут на Cursor Agents: один файл, одна проверка, один результат.",
        },
        {
          id: "old-2",
          at: Date.now() - 20 * 60_000,
          updatedAt: Date.now() - 20 * 60_000,
          expiresAt: Date.now() + 60_000,
          topicKey: "cursor agents",
          adviceCandidateKind: "refocus",
          replyText:
            "Попробуй выделить 10 минут на Cursor Agents: погрузись в один файл и реши одну задачу целиком.",
        },
      ],
    });

    expect(repeated.selected).toBeNull();
  });

  it("selects second candidate when top refocus advice repeats", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x at activeWindow.ts:42",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "activeWindow.ts - Ari - Cursor",
      sessionMinutes: 18,
    });
    const noisyBundle = {
      ...bundle,
      advisor: {
        ...bundle.advisor,
        contextThrash: true,
      },
    };
    const facts = collectProactiveSignalFacts({
      bundle: noisyBundle,
      tone: "advice",
      sessionMinutes: 18,
    });

    const plan = planAdvice({
      bundle: noisyBundle,
      facts,
      feedback: [
        {
          id: "old-1",
          at: Date.now() - 10 * 60_000,
          updatedAt: Date.now() - 10 * 60_000,
          expiresAt: Date.now() + 60_000,
          topicKey: "activewindow",
          adviceCandidateKind: "refocus",
          practicalHook:
            "Предлагаю выделить 10 минут на activeWindow.ts: один файл, одна проверка, один результат.",
        },
      ],
    });

    expect(plan.selected?.kind).not.toBe("refocus");
    expect(plan.selected?.evidenceIds.some((id) => id.startsWith("clip:"))).toBe(
      true,
    );
  });
});
