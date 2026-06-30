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

  buildFactLinkGraph,

  inferTopicChains,

} from "../src/character/proactiveTopicLinker";



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



describe("proactiveTopicLinker", () => {

  beforeEach(() => {

    setupStorage();

    invalidateActivitySignalsCache();

  });



  it("links stacktrace clipboard to same file in IDE", () => {

    recordClipboardSignal({

      clipKind: "stacktrace",

      snippet: "ReferenceError: x at ChatPanel.tsx:42",

    });

    const bundle = buildInitiativeSignalBundle(defaultSettings, {

      processName: "Cursor.exe",

      windowTitle: "ChatPanel.tsx - Ari - Cursor",

      sessionMinutes: 10,

    });

    bundle.editorFile = "ChatPanel.tsx";

    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      recentUserMessage: "почему падает сборка в ChatPanel?",
      sessionMinutes: 10,
    });
    const graph = buildFactLinkGraph(facts, bundle);

    expect(graph.some((link) => link.relation === "same_file")).toBe(true);
  });



  it("builds chain summary from graph edges", () => {

    recordClipboardSignal({

      clipKind: "stacktrace",

      snippet: "ReferenceError: build failed at ChatPanel.tsx:42",

    });

    const bundle = buildInitiativeSignalBundle(defaultSettings, {

      processName: "Cursor.exe",

      windowTitle: "ChatPanel.tsx - Ari - Cursor",

      sessionMinutes: 10,

    });

    const facts = collectProactiveSignalFacts({

      bundle,

      tone: "advice",

      recentUserMessage: "почему падает сборка ChatPanel?",

      sessionMinutes: 10,

    });

    const graph = buildFactLinkGraph(facts, bundle);

    const chains = inferTopicChains(graph, facts, 2);



    expect(chains.length).toBeGreaterThan(0);

    expect(chains[0].summarySeed.length).toBeGreaterThan(10);

    expect(chains[0].links.length).toBeGreaterThan(0);

  });

});

