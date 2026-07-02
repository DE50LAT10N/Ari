import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  buildAdviceFallbackBundle,
  buildClarifyingProbeBundle,
  collectProactiveSignalFacts,
  tryAdviceFallbackChain,
} from "../src/character/proactiveLlmEngine";
import { recordWorkingEvent } from "../src/memory/workingMemory";
import { recordClipboardSignal } from "../src/memory/activitySignals";

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
}

describe("advicePrepareGate", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("builds fallback bundle from working-memory facts when planner has no candidate", () => {
    recordWorkingEvent({
      kind: "user_action",
      topic: "Открыл IDE (Cursor.exe)",
      app: "Cursor.exe",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 6,
    });
    expect(facts.some((fact) => fact.kind === "wm")).toBe(true);

    const fallback = buildAdviceFallbackBundle(
      {
        bundle,
        tone: "advice",
        candidateTopics: ["ChatPanel.tsx"],
        sessionMinutes: 6,
      },
      facts,
      "llm synthesis rejected",
    );

    expect(fallback).not.toBeNull();
    expect(fallback?.shouldSend).toBe(true);
    expect(fallback?.practicalHook).toMatch(/шаг/i);
  });

  it("builds sendable fallback when overlapsBanned would block LLM bundle", () => {
    recordWorkingEvent({
      kind: "focus_update",
      topic: "ADVISOR_SIMULATION_REPORT.md",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ADVISOR_SIMULATION_REPORT.md - Ari - Cursor",
      sessionMinutes: 8,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 8,
      urgency: {
        level: "medium",
        score: 5,
        reasons: ["активный режим"],
        effectiveIntervalMs: 60_000,
      },
    });

    const fallback = buildAdviceFallbackBundle(
      {
        bundle,
        tone: "advice",
        candidateTopics: ["ADVISOR_SIMULATION_REPORT.md"],
        sessionMinutes: 8,
      },
      facts,
      "llm synthesis overlaps banned",
    );

    expect(fallback?.shouldSend).toBe(true);
    expect(fallback?.overlapsBanned).toBe(false);
    expect(fallback?.usefulnessScore).toBeGreaterThan(0.45);
  });

  it("builds substantive clipboard fallback before generic when clipboard can answer", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: Cannot read properties of undefined",
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
    const clarifying = buildClarifyingProbeBundle(
      { bundle, tone: "advice", sessionMinutes: 8 },
      facts,
      "llm synthesis rejected",
    );
    const chained = tryAdviceFallbackChain(
      { bundle, tone: "advice", sessionMinutes: 8 },
      facts,
      "llm synthesis rejected",
    );

    expect(clarifying?.shouldSend).toBe(true);
    expect(clarifying?.initiativeMove).toBe("clipboard_probe");
    expect(chained?.rejectReason).toContain("fallback");
    expect(chained?.initiativeMove).toBe("concrete_step");
    expect(chained?.selectedAdviceCandidate?.kind).toBe("debug_next_step");
    expect(chained?.practicalHook).toMatch(/TypeError|буфер/i);
    expect(buildAdviceFallbackBundle(
      { bundle, tone: "advice", sessionMinutes: 8 },
      facts.filter((fact) => fact.kind !== "clipboard"),
      "llm synthesis rejected",
    )?.initiativeMove).toBe("concrete_step");
  });
});
