import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordQueryTopic,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  decideAdviceStrategy,
  gatherAdviceContext,
  resetAdviceEngineForTests,
  runAdviceCycle,
  shouldAttemptAdviceCycle,
} from "../src/character/adviceEngine";
import {
  computeCadencePressure,
  scoreAdviceUrgency,
} from "../src/character/adviceUrgency";
import {
  invalidateProactiveStateCache,
  resetProactiveStateForTests,
} from "../src/character/proactiveState";
import {
  rememberAdviceSent,
  resetAdviceLedgerForTests,
} from "../src/character/adviceLedger";
import { recordWorkingEvent, invalidateWorkingMemoryCache } from "../src/memory/workingMemory";
import { completeLlmJson } from "../src/llm/llmClient";
import { resetProactiveLlmCacheForTests } from "../src/character/proactiveLlmEngine";

vi.mock("../src/llm/llmClient", () => ({
  completeLlmJson: vi.fn(),
}));

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
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
}

describe("adviceEngine", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateWorkingMemoryCache();
    invalidateProactiveStateCache();
    resetProactiveStateForTests();
    resetAdviceLedgerForTests();
    resetAdviceEngineForTests();
    resetProactiveLlmCacheForTests();
    vi.mocked(completeLlmJson).mockReset();
  });

  it("defers to smalltalk for thin file-only context under soft cadence pressure", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-1",
      signalSummary: "test",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = {
      level: "low" as const,
      score: 2,
      reasons: ["активный режим в IDE"],
      effectiveIntervalMs: 60_000,
      subjectKey: "main.tsx",
    };
    const ctx = gatherAdviceContext({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 6 },
      llmOnline: true,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });
    expect(ctx.cadencePressure.level).toBe("medium");
    const { strategy, trace } = decideAdviceStrategy(ctx);
    expect(strategy).toBe("DEFER_SMALLTALK");
    expect(trace.some((step) => step.stage === "signals")).toBe(true);
  });

  it("does not rotate thin file context after it was already clarified", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "main.tsx",
      signalSummary: "test",
      adviceCandidateKind: "clarifying_probe",
      practicalHook:
        "Сейчас фокус на main.tsx — дописываешь запись к релизу или правишь уже существующий блок?",
      replyText:
        "Сейчас фокус на main.tsx — дописываешь запись к релизу или правишь уже существующий блок?",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = {
      level: "medium" as const,
      score: 5,
      reasons: ["активный режим в IDE"],
      effectiveIntervalMs: 60_000,
      subjectKey: "main.tsx",
    };
    const ctx = gatherAdviceContext({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 6 },
      llmOnline: true,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });
    const { strategy } = decideAdviceStrategy(ctx);
    expect(strategy).toBe("DEFER_SMALLTALK");
  });

  it("does not treat substantive ide_invite advice as clarifying", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "main.tsx",
      signalSummary: "test",
      initiativeMove: "ide_invite",
      adviceCandidateKind: "debug_next_step",
      practicalHook: "Открой main.tsx и проверь порядок импортов.",
      replyText: "Открой main.tsx и проверь порядок импортов.",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = {
      level: "medium" as const,
      score: 5,
      reasons: ["активный режим в IDE"],
      effectiveIntervalMs: 60_000,
      subjectKey: "main.tsx",
    };
    const ctx = gatherAdviceContext({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 6 },
      llmOnline: true,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });
    const { strategy, trace } = decideAdviceStrategy(ctx);
    expect(strategy).not.toBe("SILENT");
    expect(trace.some((step) => step.detail.includes("clarifying по файлу уже был"))).toBe(
      false,
    );
  });

  it("defers thin file context after advice streak instead of inventing a new file tip", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-1",
      signalSummary: "test",
    });
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-2",
      signalSummary: "test",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = {
      level: "medium" as const,
      score: 5,
      reasons: ["активный режим в IDE"],
      effectiveIntervalMs: 60_000,
      subjectKey: "main.tsx",
    };
    const ctx = gatherAdviceContext({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 6 },
      llmOnline: true,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });
    expect(ctx.cadencePressure.reasons.some((reason) => /серия/i.test(reason))).toBe(
      true,
    );
    const { strategy } = decideAdviceStrategy(ctx);
    expect(strategy).toBe("DEFER_SMALLTALK");
  });

  it("downgrades to ROTATE_TOPIC under high cadence pressure with rich context", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-1",
      signalSummary: "test",
    });
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-2",
      signalSummary: "test",
    });
    recordClipboardSignal({
      clipKind: "code",
      snippet: "export function checkInitiative() { /* main.tsx */ }",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 3,
    });
    const urgency = {
      level: "medium" as const,
      score: 5,
      reasons: ["активный режим в IDE", "недавний вопрос"],
      effectiveIntervalMs: 60_000,
      subjectKey: "main.tsx",
    };
    const pressure = computeCadencePressure(urgency, 120_000);
    expect(pressure.level).toBe("high");

    const ctx = gatherAdviceContext({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 3 },
      llmOnline: true,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });
    const { strategy } = decideAdviceStrategy(ctx);
    expect(strategy).toBe("ROTATE_TOPIC");
  });

  it("invariant: actionable signals + safety pass never returns SILENT", () => {
    recordQueryTopic({
      topic: "Подготовка к стажировке по Python",
      source: "browser",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 6,
    });
    const ctx = gatherAdviceContext({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 6 },
      llmOnline: true,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 600_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });
    const { strategy } = decideAdviceStrategy(ctx);
    expect(strategy).not.toBe("SILENT");
  });

  it("runAdviceCycle defers file-only advice when LLM is offline", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 6,
    });
    const decision = await runAdviceCycle({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 6 },
      llmOnline: false,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 600_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });
    expect(decision.deliver).toBe(false);
    expect(decision.strategy).toBe("DEFER_SMALLTALK");
    expect(decision.trace.length).toBeGreaterThan(0);
  });

  it("runAdviceCycle still delivers clipboard-grounded advice when LLM is offline", async () => {
    recordClipboardSignal({
      clipKind: "diagnostic",
      snippet: "ReferenceError: action is not defined at main.tsx:42",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 6,
    });
    const decision = await runAdviceCycle({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 6 },
      llmOnline: false,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 600_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });

    expect(decision.deliver).toBe(true);
    expect(decision.bundle?.shouldSend).toBe(true);
    expect(decision.package?.proactiveReplyTone).toBe("advice");
  });

  it("runAdviceCycle delivers bundle from LLM synthesis", async () => {
    recordQueryTopic({
      topic: "интегралы в Python",
      source: "chat",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "README.md - Ari - Cursor",
      sessionMinutes: 8,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 8,
    });
    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: ["интегралы", "README.md"],
      mergedAnchor: "README.md",
      narrativeBrief: "Связь поиска по интегралам с README.md",
      practicalHook:
        "Ты искал интегралы — проверь раздел с примерами в README.md, строка с import math.",
      adviceSteps: ["открыть README.md", "найти пример интеграла"],
      usefulnessScore: 0.72,
      shouldSend: true,
      overlapsBanned: false,
    });

    const decision = await runAdviceCycle({
      settings: defaultSettings,
      bundle,
      urgency,
      packageOptions: { sessionMinutes: 8 },
      llmOnline: true,
      advisorEnabled: true,
      sinceAdviceAttemptMs: 600_000,
      adviceIntervalMs: 60_000,
      safety: { idleGateOpen: true, loading: false },
    });

    expect(decision.deliver).toBe(true);
    expect(decision.strategy).not.toBe("SILENT");
    expect(decision.bundle?.usefulnessScore).toBeGreaterThan(0.45);
    if (decision.strategy !== "CLARIFY") {
      expect(decision.trace.some((step) => step.stage === "synthesis")).toBe(true);
    }
  });

  it("shouldAttemptAdviceCycle respects advisor and idle gates", () => {
    const urgency = {
      level: "low" as const,
      score: 2,
      reasons: ["активный режим"],
      effectiveIntervalMs: 60_000,
    };
    expect(
      shouldAttemptAdviceCycle({
        advisorEnabled: false,
        idleGateOpen: true,
        loading: false,
        urgency,
        hasActionableSignals: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptAdviceCycle({
        advisorEnabled: true,
        idleGateOpen: false,
        loading: false,
        urgency,
        hasActionableSignals: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptAdviceCycle({
        advisorEnabled: true,
        idleGateOpen: true,
        loading: false,
        urgency,
        hasActionableSignals: true,
        sinceAdviceAttemptMs: 5_000,
        adviceIntervalMs: 60_000,
      }),
    ).toBe(false);
    expect(
      shouldAttemptAdviceCycle({
        advisorEnabled: true,
        idleGateOpen: true,
        loading: false,
        urgency,
        hasActionableSignals: true,
        sinceAdviceAttemptMs: 120_000,
        adviceIntervalMs: 60_000,
      }),
    ).toBe(true);
  });
});
