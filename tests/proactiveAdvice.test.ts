import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  buildLiveCodingTopic,
  isInitiativeTopicAllowed,
} from "../src/character/advisorEngine";
import {
  codingSessionMinutes,
  touchCodingSession,
} from "../src/character/codingSession";
import { defaultSettings } from "../src/settings/appSettings";
import {
  classifyProactiveReplyTone,
  isProactiveWorkContext,
} from "../src/character/proactiveTone";
import { rememberProactiveSubject } from "../src/character/proactiveState";
import { invalidateActivitySignalsCache } from "../src/memory/activitySignals";

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

describe("coding session and proactive advice", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
  });
  it("keeps coding session across IDE tab switches", () => {
    const start = Date.now() - 5 * 60_000;
    let session = touchCodingSession(null, "Cursor.exe", true, start);
    session = touchCodingSession(session, "Cursor.exe", true, start + 60_000);
    expect(codingSessionMinutes(session, start + 120_000)).toBe(2);
  });

  it("resets coding session when leaving IDE", () => {
    const now = Date.now();
    const session = touchCodingSession(null, "Cursor.exe", true, now - 120_000);
    expect(touchCodingSession(session, "chrome.exe", false, now)).toBeNull();
  });

  it("detects work context from sustained coding session despite short tab dwell", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "notes.md - Ari - Cursor",
      sessionMinutes: 4,
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
        editorContext: {},
        repeatedErrorSignature: undefined,
        stuckScore: 0,
        topQueryThemes: [],
      },
    };
    expect(
      isProactiveWorkContext({ bundle: windowOnly, sessionMinutes: 4 }),
    ).toBe(true);
  });

  it("classifies smalltalk when only social topics even with coding file visible", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 5,
      windowMinutes: 1,
    });
    expect(
      classifyProactiveReplyTone({
        initiativeKind: "check_in",
        bundle,
        conversationTopics: ["как прошло «Deploy»"],
      }),
    ).toBe("smalltalk");
  });

  it("builds live coding topic from current editor file", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "taskChatParse.ts - Ari - Cursor",
    });
    expect(buildLiveCodingTopic(bundle)).toContain("taskChatParse.ts");
  });

  it("allows file topic when file changed since last proactive subject", () => {
    rememberProactiveSubject("практический следующий шаг по ChatPanel.tsx");
    const newTopic = "практический следующий шаг по advisorEngine.ts";
    expect(
      isInitiativeTopicAllowed(newTopic, [], {
        currentFile: "advisorEngine.ts",
      }),
    ).toBe(true);
    expect(
      isInitiativeTopicAllowed(newTopic, [], {
        currentFile: "ChatPanel.tsx",
      }),
    ).toBe(false);
  });
});
