import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  rankRelevanceCandidates,
  recordRelevanceFeedback,
  recordRelevanceOutcome,
  resetRelevanceRankerForTests,
  scoreRelevanceCandidate,
} from "../src/character/relevanceRanker";
import type { AdviceLedgerEntry } from "../src/character/adviceLedger";

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
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
}

describe("relevanceRanker", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    resetRelevanceRankerForTests();
  });

  it("prefers advice over smalltalk for structured clipboard in IDE", () => {
    recordClipboardSignal({
      clipKind: "text",
      snippet: "Gates{Quiet? Offline? Busy?}\nInput{User message} --> Cmd{Chat command?}",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ARCHITECTURE.md - desktop-character - Cursor",
      sessionMinutes: 12,
      windowMinutes: 8,
    });

    const ranked = rankRelevanceCandidates(["try_advice", "try_smalltalk"], {
      bundle,
      adviceReady: true,
      smalltalkReady: true,
      llmOnline: true,
      idleGateOpen: true,
      loading: false,
      toneSnapshot: { adviceToday: 0, smalltalkToday: 0, recent: [] },
    });

    expect(ranked[0]?.kind).toBe("try_advice");
    expect(ranked[0]?.reasons.join(" ")).toMatch(/clipboard rich|IDE/i);
  });

  it("prefers smalltalk when only the smalltalk timer is ready", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {});
    const ranked = rankRelevanceCandidates(["try_smalltalk", "silent"], {
      bundle,
      adviceReady: false,
      smalltalkReady: true,
      llmOnline: true,
      idleGateOpen: true,
      loading: false,
      toneSnapshot: { adviceToday: 0, smalltalkToday: 0, recent: [] },
    });

    expect(ranked[0]?.kind).toBe("try_smalltalk");
  });

  it("learns from explicit useful feedback for the same candidate shape", () => {
    const entry: AdviceLedgerEntry = {
      id: "advice-1",
      at: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 60_000,
      topicKey: "clip",
      tone: "advice",
      practicalHook:
        "Разбери буфер Gates{Quiet? Offline? Busy?}: проверь связь Input --> Cmd.",
      adviceCandidateKind: "debug_next_step",
    };
    const bundle = buildInitiativeSignalBundle(defaultSettings, {});
    const before = scoreRelevanceCandidate("debug_next_step", {
      bundle,
      facts: [
        {
          id: "clip:text",
          kind: "clipboard",
          label: "Буфер",
          detail:
            "Gates{Quiet? Offline? Busy?}\nInput{User message} --> Cmd{Chat command?}",
        },
      ],
    }).score;

    recordRelevanceFeedback(entry, "useful");

    const after = scoreRelevanceCandidate("debug_next_step", {
      bundle,
      facts: [
        {
          id: "clip:text",
          kind: "clipboard",
          label: "Буфер",
          detail:
            "Gates{Quiet? Offline? Busy?}\nInput{User message} --> Cmd{Chat command?}",
        },
      ],
    }).score;
    expect(after).toBeGreaterThan(before);
  });

  it("learns softly from passive resolved advice outcomes", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {});
    const facts = [
      {
        id: "clip:text",
        kind: "clipboard" as const,
        label: "Буфер",
        detail:
          "Gates{Quiet? Offline? Busy?}\nInput{User message} --> Cmd{Chat command?}\nReferenceError",
      },
    ];
    const before = scoreRelevanceCandidate("debug_next_step", {
      bundle,
      facts,
    }).score;

    recordRelevanceOutcome({
      candidateKind: "debug_next_step",
      outcome: "resolved",
      confidence: 0.8,
      reason: "ошибочный сигнал исчез после совета",
      beforeState: {
        processName: "Cursor.exe",
        windowTitle: "ARCHITECTURE.md - desktop-character - Cursor",
        editorFile: "ARCHITECTURE.md",
        factIds: ["clip:text"],
        factSummary:
          "Gates{Quiet? Offline? Busy?}\nInput{User message} --> Cmd{Chat command?}\nReferenceError",
        hasErrorSignal: true,
        stuckScore: 0.6,
        openTaskCount: 1,
        breakDue: false,
      },
    });

    const after = scoreRelevanceCandidate("debug_next_step", {
      bundle,
      facts,
    }).score;
    expect(after).toBeGreaterThan(before);
  });
});
