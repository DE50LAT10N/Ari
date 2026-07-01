import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  isAdviceReady,
  planSignalDrivenAdvice,
  scoreAdviceUrgency,
  shouldOfferLlmAdvice,
} from "../src/character/adviceUrgency";
import { buildAdviceBrief } from "../src/character/proactiveContextRich";
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
    invalidateProactiveStateCache();
    resetProactiveStateForTests();
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

  it("does not offer advice when score is zero", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {});
    const urgency = scoreAdviceUrgency(bundle, defaultSettings);
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
    rememberAdviceSubject("ChatPanel.tsx");
    if (urgency.subjectKey) {
      expect(
        isAdviceReady(urgency, urgency.effectiveIntervalMs + 1_000),
      ).toBe(false);
    }
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
});
