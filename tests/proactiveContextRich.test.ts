import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  buildAdviceBrief,
  buildRichProactiveContext,
  buildSmalltalkAngles,
} from "../src/character/proactiveContextRich";
import { scoreAdviceUrgency } from "../src/character/adviceUrgency";
import { recordWorkingEvent, invalidateWorkingMemoryCache } from "../src/memory/workingMemory";

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

describe("proactiveContextRich", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateWorkingMemoryCache();
  });

  it("includes session, WM, urgency, and recent chat in rich context", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: boom at ChatPanel.tsx:42",
    });
    recordWorkingEvent({
      kind: "window_switch",
      topic: "переключился на ChatPanel.tsx",
      app: "Cursor",
      title: "ChatPanel.tsx - Ari",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 18,
      windowMinutes: 6,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 18,
      userIntervalMs: 20 * 60_000,
    });
    const rich = buildRichProactiveContext({
      bundle,
      sessionMinutes: 18,
      windowMinutes: 6,
      companionSilenceMs: 25 * 60_000,
      urgency,
      recentUserMessage: "почему падает сборка?",
      chatTurns: [
        { role: "user", content: "почему падает сборка?" },
        { role: "assistant", content: "посмотрю на ошибку" },
      ],
    });
    expect(rich).toMatch(/Сессия:/);
    expect(rich).toMatch(/не общались/i);
    expect(rich).toMatch(/Кратковременная память|переключ/i);
    expect(rich).toMatch(/Срочность совета|буфер/i);
    expect(rich).toMatch(/почему падает сборк/i);
    expect(rich).toMatch(/Недавний диалог/i);
  });

  it("smalltalk angles avoid practical next-step phrasing", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Spotify.exe",
      windowTitle: "Discover Weekly",
      sessionMinutes: 3,
    });
    const angles = buildSmalltalkAngles(bundle, []);
    expect(angles.length).toBeGreaterThan(0);
    for (const angle of angles) {
      expect(angle.toLowerCase()).not.toMatch(/следующий шаг/);
    }
  });

  it("advice brief summarizes urgency reasons and file focus", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x is not defined",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "proactiveContextRich.ts - Ari - Cursor",
      sessionMinutes: 10,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 10,
      userIntervalMs: 20 * 60_000,
    });
    const brief = buildAdviceBrief(urgency, bundle);
    expect(brief).toMatch(/срочность|буфер|proactiveContextRich/i);
  });
});
