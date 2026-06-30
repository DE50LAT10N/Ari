import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultSettings } from "../src/settings/appSettings";

import {

  invalidateActivitySignalsCache,

  recordClipboardSignal,

} from "../src/memory/activitySignals";

import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";

import {

  collectProactiveSignalFacts,

} from "../src/character/proactiveLlmEngine";

import {

  inferInitiativeMoves,

  pickBestMoveHint,

} from "../src/character/proactiveInitiativePlaybook";



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



describe("proactiveInitiativePlaybook", () => {

  beforeEach(() => {

    setupStorage();

    invalidateActivitySignalsCache();

  });



  it("prefers clipboard_probe when stacktrace is in clipboard", () => {

    recordClipboardSignal({

      clipKind: "stacktrace",

      snippet: "TypeError: x is not a function at ChatPanel.tsx:42",

    });

    const bundle = buildInitiativeSignalBundle(defaultSettings, {

      processName: "Cursor.exe",

      windowTitle: "ChatPanel.tsx - Ari - Cursor",

      sessionMinutes: 12,

    });

    const facts = collectProactiveSignalFacts({

      bundle,

      tone: "advice",

      recentUserMessage: "почему падает сборка?",

      sessionMinutes: 12,

    });

    const hints = inferInitiativeMoves(bundle, facts);

    const best = pickBestMoveHint(hints);



    expect(hints.some((hint) => hint.move === "clipboard_probe")).toBe(true);

    expect(best?.move).toBe("clipboard_probe");

    expect(best?.requireQuoteFromFacts).toBe(true);

    expect(best?.hookSeed).toMatch(/TypeError|ChatPanel/i);

  });



  it("uses a long clipboard quote in probe hook when available", () => {
    const snippet =
      "ReferenceError: cannot read property at ChatPanel.tsx:42 in buildReply";
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet,
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 5,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 5,
    });
    const hints = inferInitiativeMoves(bundle, facts);
    const probe = hints.find((hint) => hint.move === "clipboard_probe");

    expect(probe?.hookSeed).toContain("ReferenceError");
    expect(probe?.hookSeed.length).toBeGreaterThan(60);
  });



  it("suggests ide_invite when stuck on file in IDE window", () => {

    const bundle = buildInitiativeSignalBundle(defaultSettings, {

      processName: "Cursor.exe",

      windowTitle: "ChatPanel.tsx - Ari - Cursor",

      sessionMinutes: 45,

    });

    bundle.advisor.stuckScore = 0.6;

    const facts = collectProactiveSignalFacts({

      bundle,

      tone: "advice",

      sessionMinutes: 45,

      urgency: {

        level: "high",

        score: 0.7,

        reasons: ["застрял на file:ChatPanel.tsx"],

        effectiveIntervalMs: 60_000,

      },

    });

    const hints = inferInitiativeMoves(bundle, facts);



    expect(hints.some((hint) => hint.move === "ide_invite")).toBe(true);

  });



  it("activates context_fact when RAG snippets are provided", () => {

    const bundle = buildInitiativeSignalBundle(defaultSettings, {

      processName: "Cursor.exe",

      windowTitle: "perf.ts - Ari - Cursor",

      sessionMinutes: 8,

    });

    const facts = collectProactiveSignalFacts({

      bundle,

      tone: "advice",

      sessionMinutes: 8,

    });

    const hints = inferInitiativeMoves(bundle, facts, [

      "Amdahl's law: speedup is limited by the serial portion of the workload.",

    ]);



    expect(hints.some((hint) => hint.move === "context_fact")).toBe(true);

  });

});

