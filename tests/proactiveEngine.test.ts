import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import { planProactiveEngineTick } from "../src/character/proactiveEngine";
import type { AdviceUrgency } from "../src/character/adviceUrgency";

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
}

function noneUrgency(): AdviceUrgency {
  return {
    level: "none",
    score: 0,
    reasons: [],
    effectiveIntervalMs: 60_000,
  };
}

describe("proactiveEngine", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("keeps smalltalk path unchanged when advice is not ready", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {});
    const decision = planProactiveEngineTick({
      settings: defaultSettings,
      bundle,
      urgency: noneUrgency(),
      llmOnline: true,
      idleGateOpen: true,
      loading: false,
      smalltalkReady: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      toneSnapshot: { adviceToday: 0, smalltalkToday: 0, recent: [] },
      recentAdviceStreak: 0,
    });

    expect(decision.action).toBe("try_smalltalk");
    expect(decision.allowSmalltalk).toBe(true);
  });

  it("escalates starved actionable advice without changing smalltalk code path", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "adviceEngine.ts - desktop-character - Cursor",
      sessionMinutes: 8,
      windowMinutes: 8,
    });
    const decision = planProactiveEngineTick({
      settings: defaultSettings,
      bundle,
      urgency: {
        level: "low",
        score: 2,
        reasons: ["input friction"],
        effectiveIntervalMs: 60_000,
      },
      llmOnline: true,
      idleGateOpen: true,
      loading: false,
      smalltalkReady: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      toneSnapshot: { adviceToday: 0, smalltalkToday: 3, recent: [] },
      recentAdviceStreak: 0,
    });

    expect(decision.action).toBe("try_advice");
    expect(decision.adviceStarved).toBe(true);
    expect(decision.adviceUrgency.level).toBe("low");
  });

  it("protects smalltalk when advice is not ready after an advice streak", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {});
    const decision = planProactiveEngineTick({
      settings: defaultSettings,
      bundle,
      urgency: noneUrgency(),
      llmOnline: true,
      idleGateOpen: true,
      loading: false,
      smalltalkReady: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      toneSnapshot: { adviceToday: 2, smalltalkToday: 1, recent: [] },
      recentAdviceStreak: 1,
    });

    expect(decision.action).toBe("try_smalltalk");
    expect(decision.reason).toBe("protected smalltalk timer");
  });

  it("does not protect smalltalk over ready medium-urgency advice", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "adviceEngine.ts - desktop-character - Cursor",
      sessionMinutes: 8,
      windowMinutes: 8,
    });
    const decision = planProactiveEngineTick({
      settings: defaultSettings,
      bundle,
      urgency: {
        level: "medium",
        score: 4,
        reasons: ["input friction"],
        effectiveIntervalMs: 60_000,
      },
      llmOnline: true,
      idleGateOpen: true,
      loading: false,
      smalltalkReady: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      toneSnapshot: { adviceToday: 2, smalltalkToday: 1, recent: [] },
      recentAdviceStreak: 1,
    });

    expect(decision.action).toBe("try_advice");
  });

  it("still lets high urgency advice preempt the smalltalk timer", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "adviceEngine.ts - desktop-character - Cursor",
      sessionMinutes: 8,
      windowMinutes: 8,
    });
    const decision = planProactiveEngineTick({
      settings: defaultSettings,
      bundle,
      urgency: {
        level: "high",
        score: 7,
        reasons: ["fresh stacktrace"],
        effectiveIntervalMs: 60_000,
      },
      llmOnline: true,
      idleGateOpen: true,
      loading: false,
      smalltalkReady: true,
      sinceAdviceAttemptMs: 120_000,
      adviceIntervalMs: 60_000,
      toneSnapshot: { adviceToday: 2, smalltalkToday: 1, recent: [] },
      recentAdviceStreak: 1,
    });

    expect(decision.action).toBe("try_advice");
  });
});
