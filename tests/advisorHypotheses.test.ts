import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdvisorHypotheses } from "../src/character/advisorHypotheses";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import { collectProactiveSignalFacts } from "../src/character/proactiveLlmEngine";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordQueryTopic,
} from "../src/memory/activitySignals";
import { defaultSettings } from "../src/settings/appSettings";

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

describe("advisorHypotheses", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
  });

  it("builds a test failure hypothesis from visible stacktrace", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "FAIL tests/screenState.test.ts expected true received false",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "WindowsTerminal.exe",
      windowTitle: "pnpm vitest",
      sessionMinutes: 6,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 6,
    });

    const hypotheses = buildAdvisorHypotheses(bundle, facts);

    expect(hypotheses[0]?.kind).toBe("test_failure");
    expect(hypotheses[0]?.suggestedMove).toBe("advise");
    expect(hypotheses[0]?.evidenceFactIds.length).toBeGreaterThan(0);
  });

  it("connects browser search themes to the current file", () => {
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

    const hypotheses = buildAdvisorHypotheses(bundle, facts);

    expect(hypotheses.some((hypothesis) => hypothesis.kind === "docs_to_code")).toBe(true);
  });
});
