import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { recordWorkingEvent, invalidateWorkingMemoryCache } from "../src/memory/workingMemory";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  describeAdviceReadiness,
  getAdviceReadinessBlockReason,
  isAdviceReady,
  planSignalDrivenAdvice,
  scoreAdviceUrgency,
  shouldOfferLlmAdvice,
} from "../src/character/adviceUrgency";
import { rememberAdviceSent, resetAdviceLedgerForTests } from "../src/character/adviceLedger";
import { buildAdviceBrief } from "../src/character/proactiveContextRich";
import { selectAdvisorAngle } from "../src/character/advisorEngine";
import {
  MEDIUM_ADVICE_CAP_MS,
  proactiveAdviceIntervalMs,
  URGENT_ADVICE_MIN_MS,
} from "../src/character/initiativeConfig";
import {
  invalidateProactiveStateCache,
  rememberAdviceSubject,
  resetProactiveStateForTests,
} from "../src/character/proactiveState";

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

describe("adviceUrgency", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateWorkingMemoryCache();
    invalidateProactiveStateCache();
    resetProactiveStateForTests();
    resetAdviceLedgerForTests();
  });

  it("scores high urgency for stacktrace and stuck file", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: Cannot read properties of undefined",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "app.ts - Ari - Cursor",
      sessionMinutes: 8,
    });
    const stuckBundle = {
      ...bundle,
      advisor: { ...bundle.advisor, stuckScore: 0.55 },
    };
    const urgency = scoreAdviceUrgency(stuckBundle, defaultSettings, {
      sessionMinutes: 8,
      userIntervalMs: 20 * 60_000,
    });
    expect(urgency.level).toBe("high");
    expect(urgency.effectiveIntervalMs).toBe(URGENT_ADVICE_MIN_MS);
    expect(urgency.reasons.some((r) => r.includes("буфер"))).toBe(true);
  });

  it("raises urgency for fresh generic text in clipboard", () => {
    recordClipboardSignal({
      clipKind: "text",
      snippet: "npm run test:unit failed with 3 errors",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "package.json - Ari - Cursor",
      sessionMinutes: 5,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 5,
      userIntervalMs: 20 * 60_000,
    });

    expect(urgency.score).toBeGreaterThanOrEqual(1);
    expect(
      urgency.reasons.some((reason) => /содержательный буфер|буфер/i.test(reason)),
    ).toBe(
      true,
    );
  });

  it("does not offer low urgency for sustained IDE without strong signals", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "notes.md - Ari - Cursor",
      sessionMinutes: 4,
    });
    const windowOnly = {
      ...bundle,
      clipboardSnippets: [],
      advisor: {
        ...bundle.advisor,
        stuckScore: 0,
        repeatedErrorSignature: undefined,
        topQueryThemes: [],
        activitySummary: {
          ...bundle.advisor.activitySummary,
          repeatedErrorCount: 0,
        },
      },
    };
    const urgency = scoreAdviceUrgency(windowOnly, defaultSettings, {
      sessionMinutes: 4,
      userIntervalMs: 20 * 60_000,
    });
    expect(urgency.level).toBe("none");
    expect(shouldOfferLlmAdvice(urgency)).toBe(false);
  });

  it("raises medium urgency for active mode with sustained IDE work", () => {
    const activeSettings = {
      ...defaultSettings,
      initiativeLevel: "active" as const,
    };
    const bundle = buildInitiativeSignalBundle(activeSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, activeSettings, {
      sessionMinutes: 6,
      userIntervalMs: 20 * 60_000,
    });

    expect(urgency.level).toBe("medium");
    expect(shouldOfferLlmAdvice(urgency)).toBe(true);
    expect(urgency.reasons.some((reason) => reason.includes("активный режим"))).toBe(true);
  });

  it("offers low urgency for sustained live IDE work with a shorter cap", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 6,
      userIntervalMs: 20 * 60_000,
    });

    expect(urgency.level).toBe("low");
    expect(urgency.effectiveIntervalMs).toBe(MEDIUM_ADVICE_CAP_MS);
    expect(shouldOfferLlmAdvice(urgency)).toBe(true);
  });

  it("raises low urgency from working memory focus updates", () => {
    recordWorkingEvent({
      kind: "focus_update",
      topic: "Помодоро: дописать adviceUrgency",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "adviceUrgency.ts - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 6,
      userIntervalMs: 20 * 60_000,
    });
    expect(urgency.level).not.toBe("none");
    expect(urgency.reasons.some((reason) => reason.includes("памяти"))).toBe(
      true,
    );
  });

  it("offers low urgency for recent activity without strict work context", () => {
    recordWorkingEvent({
      kind: "window_switch",
      topic: "переключение на браузер",
      app: "chrome",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "chrome.exe",
      windowTitle: "GitHub - Google Chrome",
      sessionMinutes: 2,
    });
    const nonWorkBundle = {
      ...bundle,
      editorFile: undefined,
      projectContext: undefined,
      focusStep: undefined,
      focusBlockers: [],
      nextTaskTitle: undefined,
      taskActivityLink: undefined,
      clipboardSnippets: [],
      advisor: {
        ...bundle.advisor,
        dominantFile: undefined,
        topQueryThemes: [],
        contextThrash: true,
        activitySummary: {
          ...bundle.advisor.activitySummary,
          recentSignals: [],
        },
      },
    };
    const urgency = scoreAdviceUrgency(nonWorkBundle, defaultSettings, {
      sessionMinutes: 2,
      userIntervalMs: 20 * 60_000,
    });
    expect(urgency.level).toBe("low");
    expect(shouldOfferLlmAdvice(urgency)).toBe(true);
    expect(urgency.effectiveIntervalMs).toBe(20 * 60_000);
  });

  it("does not offer advice when score is zero", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {});
    const zeroed = {
      ...bundle,
      editorFile: undefined,
      advisor: {
        ...bundle.advisor,
        dominantFile: undefined,
        contextThrash: false,
        scopeCreep: false,
        progressWin: false,
        activitySummary: {
          ...bundle.advisor.activitySummary,
          recentSignals: [],
        },
      },
    };
    const urgency = scoreAdviceUrgency(zeroed, defaultSettings, {
      sessionMinutes: 0,
    });
    expect(shouldOfferLlmAdvice(urgency)).toBe(false);
    expect(isAdviceReady(urgency, 60_000)).toBe(false);
  });

  it("ignores stale advice attempt cooldown when no advice was actually sent", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: Cannot read properties of undefined",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 8,
      userIntervalMs: 20 * 60_000,
    });

    expect(urgency.level).toBe("high");
    expect(isAdviceReady(urgency, 30_000, Date.now(), 20 * 60_000)).toBe(true);
  });

  it("caps medium urgency interval at ten minutes", () => {
    recordClipboardSignal({
      clipKind: "code",
      snippet: "function handleInitiative() { return true; }",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 5,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      userIntervalMs: 20 * 60_000,
    });
    if (urgency.level === "medium") {
      expect(urgency.effectiveIntervalMs).toBe(MEDIUM_ADVICE_CAP_MS);
    }
  });

  it("blocks repeated advice on same subject within effective interval", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 5,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      userIntervalMs: proactiveAdviceIntervalMs(defaultSettings),
    });
    expect(urgency.subjectKey).toBeTruthy();
    rememberAdviceSubject(urgency.subjectKey!);
    expect(
      isAdviceReady(urgency, urgency.effectiveIntervalMs + 1_000),
    ).toBe(false);
  });

  it("plans process_advice with live file topic", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "adviceUrgency.ts - Ari - Cursor",
      sessionMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 6,
    });
    const plan = planSignalDrivenAdvice(bundle, urgency);
    expect(plan.kind).toBe("process_advice");
    expect(
      plan.conversationTopics.some((topic) =>
        topic.includes("adviceUrgency.ts"),
      ),
    ).toBe(true);
  });

  it("does not pick debug_help from light friction alone (keeps topic)", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "foo.ts - Ari - Cursor",
      sessionMinutes: 6,
    });

    const frictionOnly = {
      ...bundle,
      advisor: {
        ...bundle.advisor,
        dominantFile: "foo.ts",
        stuckScore: 0,
        repeatedErrorSignature: undefined,
        breakDue: false,
        contextThrash: false,
        scopeCreep: false,
        progressWin: false,
        activitySummary: {
          ...bundle.advisor.activitySummary,
          inputFrictionScore: 1.2,
        },
      },
    };

    expect(selectAdvisorAngle(frictionOnly.advisor)).toBe("topic");
  });

  it("keeps rest/refocus priority over debug_help", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "foo.ts - Ari - Cursor",
      sessionMinutes: 40,
    });

    const wantsRest = {
      ...bundle,
      advisor: {
        ...bundle.advisor,
        dominantFile: "foo.ts",
        stuckScore: 0.5,
        breakDue: true,
        activitySummary: {
          ...bundle.advisor.activitySummary,
          inputFrictionScore: 3.5,
        },
      },
    };
    expect(selectAdvisorAngle(wantsRest.advisor)).toBe("rest");

    const wantsRefocus = {
      ...bundle,
      advisor: {
        ...bundle.advisor,
        dominantFile: "foo.ts",
        stuckScore: 0.5,
        breakDue: false,
        contextThrash: true,
        activitySummary: {
          ...bundle.advisor.activitySummary,
          inputFrictionScore: 3.5,
        },
      },
    };
    expect(selectAdvisorAngle(wantsRefocus.advisor)).toBe("refocus");
  });

  it("avoids repeating friction-based debug_help on same file", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "foo.ts",
      practicalHook: "Проверь обработчик в foo.ts",
      adviceCandidateKind: "debug_next_step",
      signalSummary: "test",
    });
    rememberAdviceSent({
      tone: "advice",
      anchor: "foo.ts",
      practicalHook: "Ещё шаг по foo.ts",
      adviceCandidateKind: "debug_next_step",
      signalSummary: "test",
    });

    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "foo.ts - Ari - Cursor",
      sessionMinutes: 8,
    });

    const frictionDebug = {
      ...bundle,
      advisor: {
        ...bundle.advisor,
        dominantFile: "foo.ts",
        stuckScore: 0.45,
        repeatedErrorSignature: undefined,
        breakDue: false,
        contextThrash: false,
        activitySummary: {
          ...bundle.advisor.activitySummary,
          inputFrictionScore: 3.2,
        },
      },
    };

    // Should fall back to "topic" (dominantFile exists) instead of debug_help.
    expect(selectAdvisorAngle(frictionDebug.advisor)).toBe("topic");
  });

  it("builds advice brief from high urgency stacktrace", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: Cannot read properties of undefined",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "adviceUrgency.ts - Ari - Cursor",
      sessionMinutes: 8,
    });
    const stuckBundle = {
      ...bundle,
      advisor: { ...bundle.advisor, stuckScore: 0.55 },
    };
    const urgency = scoreAdviceUrgency(stuckBundle, defaultSettings, {
      sessionMinutes: 8,
      userIntervalMs: 20 * 60_000,
    });
    const brief = buildAdviceBrief(urgency, stuckBundle);
    expect(urgency.level).toBe("high");
    expect(brief).toMatch(/срочность high|буфер/i);
  });

  it("bypasses low-urgency 25min cap when wm user_action is in reasons", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-advice",
      signalSummary: "test",
    });
    const urgency = {
      level: "low" as const,
      score: 2,
      reasons: ["недавнее действие в кратковременной памяти"],
      effectiveIntervalMs: 10 * 60_000,
      subjectKey: "comfyui",
    };
    expect(isAdviceReady(urgency, 600_000)).toBe(true);
    expect(getAdviceReadinessBlockReason(urgency, 600_000)).toBeNull();
  });

  it("blocks low urgency when recent advice exists without actionable bypass", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-advice",
      signalSummary: "test",
    });
    const urgency = {
      level: "low" as const,
      score: 2,
      reasons: ["активный режим в IDE"],
      effectiveIntervalMs: 10 * 60_000,
      subjectKey: "file.md",
    };
    expect(isAdviceReady(urgency, 600_000)).toBe(false);
    expect(getAdviceReadinessBlockReason(urgency, 600_000)).toBe(
      "low: уже был совет за 25 мин",
    );
  });

  it("describeAdviceReadiness reports real block reason instead of timer-only ready", () => {
    rememberAdviceSent({
      tone: "advice",
      anchor: "recent-advice",
      signalSummary: "test",
    });
    const urgency = {
      level: "low" as const,
      score: 2,
      reasons: ["активный режим в IDE"],
      effectiveIntervalMs: 10 * 60_000,
      subjectKey: "file.md",
    };
    const snapshot = describeAdviceReadiness(urgency, {
      advisorEnabled: true,
      llmOnline: true,
      sinceAdviceAttemptMs: 600_000,
      adviceIntervalMs: 10 * 60_000,
    });
    expect(snapshot.ready).toBe(false);
    expect(snapshot.blockReason).toBe("low: уже был совет за 25 мин");
    expect(snapshot.label).toBe("low: уже был совет за 25 мин");
  });
});
