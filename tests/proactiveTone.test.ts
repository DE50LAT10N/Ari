import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  advisorAngleForAdviceSignals,
  buildProactiveWebSearchQuery,
  classifyProactiveReplyTone,
  isPracticalAnchor,
  isProactiveWorkContext,
  resolveProactiveReplyTone,
  shouldProactiveWebSearch,
} from "../src/character/proactiveTone";
import { initiativeKindForAngle } from "../src/character/advisorEngine";

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

describe("proactiveTone", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
  });

  it("classifies stacktrace anchor as advice with debug bundle", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x at file.ts:1",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "file.ts - Ari - Cursor",
    });
    expect(
      classifyProactiveReplyTone({
        initiativeKind: "check_in",
        anchor: "следующий шаг отладки по ошибке из буфера",
        bundle,
        urgencyLevel: "medium",
      }),
    ).toBe("advice");
    expect(isPracticalAnchor("следующий шаг отладки по ошибке из буфера")).toBe(
      true,
    );
  });

  it("classifies social topic as smalltalk", () => {
    expect(
      classifyProactiveReplyTone({
        initiativeKind: "check_in",
        anchor: "как прошло закрытие задачи",
        conversationTopics: ["как прошло «Deploy»"],
      }),
    ).toBe("smalltalk");
  });

  it("classifies memory callback as smalltalk", () => {
    expect(
      classifyProactiveReplyTone({
        initiativeKind: "memory_callback",
        anchor: "любит кофе утром",
      }),
    ).toBe("smalltalk");
  });

  it("enables proactive web search for debug signals", () => {
    const webEnabledSettings = { ...defaultSettings, webToolsEnabled: true };
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: Cannot read properties of undefined",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Code.exe",
      windowTitle: "app.ts - project - Cursor",
    });
    expect(
      shouldProactiveWebSearch(bundle, "advice", webEnabledSettings, "отладка"),
    ).toBe(true);
    expect(
      shouldProactiveWebSearch(bundle, "smalltalk", defaultSettings),
    ).toBe(false);
  });

  it("enables proactive web search for researchable anchors and candidate kinds", () => {
    const webEnabledSettings = { ...defaultSettings, webToolsEnabled: true };
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "CHANGELOG.md - Ari - Cursor",
    });
    expect(
      shouldProactiveWebSearch(
        bundle,
        "advice",
        webEnabledSettings,
        "how to configure vite library",
        "docs_lookup",
      ),
    ).toBe(true);
    expect(
      shouldProactiveWebSearch(
        bundle,
        "advice",
        { ...defaultSettings, webToolsEnabled: false },
        "debug error",
        "debug_next_step",
      ),
    ).toBe(false);
  });

  it("builds web search query from stacktrace not window title", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "error TS2345: Argument of type 'null'",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Code.exe",
      windowTitle: "Personal cabinet — secret user data",
      windowMinutes: 20,
      sessionMinutes: 20,
    });
    const query = buildProactiveWebSearchQuery(bundle);
    expect(query).toMatch(/TS2345|Argument of type/i);
    expect(query).not.toMatch(/Personal cabinet|secret user/i);
  });

  it("routes technical topic angle to process_advice", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: foo is not defined",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Code.exe",
      windowTitle: "main.ts - repo - Cursor",
    });
    expect(initiativeKindForAngle("topic", bundle)).toBe("process_advice");
    expect(initiativeKindForAngle("celebrate", bundle)).toBe("check_in");
  });

  it("picks debug advisor angle from signals", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "panic: index out of bounds",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Code.exe",
      windowTitle: "lib.rs - repo - Cursor",
    });
    expect(advisorAngleForAdviceSignals(bundle)).toBe("debug_help");
  });

  it("detects work context from IDE session and classifies smalltalk without debug signals", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
      windowMinutes: 8,
    });
    const quietBundle = {
      ...bundle,
      clipboardSnippets: [],
      focusBlockers: [],
      advisor: {
        ...bundle.advisor,
        stuckScore: 0,
        repeatedErrorSignature: undefined,
        dominantFile: undefined,
      },
    };
    expect(
      isProactiveWorkContext({ bundle: quietBundle, sessionMinutes: 8 }),
    ).toBe(true);
    expect(
      classifyProactiveReplyTone({
        initiativeKind: "check_in",
        bundle: quietBundle,
        conversationTopics: [],
      }),
    ).toBe("smalltalk");
  });

  it("classifies check_in as advice with medium urgency and debug signals", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x at ChatPanel.tsx:42",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
      windowMinutes: 8,
    });
    expect(
      classifyProactiveReplyTone({
        initiativeKind: "check_in",
        bundle,
        conversationTopics: [],
        urgencyLevel: "medium",
      }),
    ).toBe("advice");
  });

  it("keeps quiet IDE check_in as smalltalk without urgent signals", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
      windowMinutes: 8,
    });
    const quietBundle = {
      ...bundle,
      clipboardSnippets: [],
      focusBlockers: [],
      advisor: {
        ...bundle.advisor,
        stuckScore: 0,
        repeatedErrorSignature: undefined,
        dominantFile: "ChatPanel.tsx",
      },
    };
    expect(
      classifyProactiveReplyTone({
        initiativeKind: "check_in",
        bundle: quietBundle,
        conversationTopics: ["работа над ChatPanel"],
        urgencyLevel: "low",
      }),
    ).toBe("smalltalk");
  });

  it("resolveProactiveReplyTone clamps LLM advice upgrade on check_in", () => {
    expect(
      resolveProactiveReplyTone({
        initiativeKind: "check_in",
        conversationTopics: ["как идёт"],
        llmTone: "advice",
      }),
    ).toBe("smalltalk");
  });

  it("needs sustained IDE session before window alone counts as work", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "notes.md - Ari - Cursor",
      sessionMinutes: 1,
      windowMinutes: 1,
    });
    const windowOnly = {
      ...bundle,
      editorFile: undefined,
      editorRepo: undefined,
      projectContext: undefined,
      nextTaskTitle: undefined,
      focusStep: undefined,
      focusBlockers: [],
      taskActivityLink: undefined,
      clipboardSnippets: [],
      advisor: {
        ...bundle.advisor,
        dominantFile: undefined,
        repeatedErrorSignature: undefined,
        stuckScore: 0,
        topQueryThemes: [],
      },
    };
    expect(
      isProactiveWorkContext({ bundle: windowOnly, sessionMinutes: 1 }),
    ).toBe(false);
    expect(
      isProactiveWorkContext({ bundle: windowOnly, sessionMinutes: 4 }),
    ).toBe(true);
  });

  it("detects work context sooner when editor file is visible", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 1,
      windowMinutes: 1,
    });
    expect(
      isProactiveWorkContext({ bundle, sessionMinutes: 1 }),
    ).toBe(true);
  });
});
