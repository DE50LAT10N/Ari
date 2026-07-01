import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  deriveScreenState,
  screenStateHasTestFailure,
} from "../src/character/screenState";
import { recordClipboardSignal, invalidateActivitySignalsCache } from "../src/memory/activitySignals";
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

describe("screenState", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
  });

  it("derives IDE file context from active window", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "advisorEngine.ts - Ari - Cursor",
      sessionMinutes: 7,
    });

    const state = deriveScreenState(bundle);

    expect(state.app).toBe("ide");
    expect(state.visibleCodeContext?.file).toContain("advisorEngine.ts");
    expect(state.confidence).toBeGreaterThanOrEqual(0.45);
  });

  it("detects visible test failures from clipboard stacktrace", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "FAIL tests/advicePlanner.test.ts expected 1 received 0",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "WindowsTerminal.exe",
      windowTitle: "pnpm vitest",
      sessionMinutes: 5,
    });

    const state = deriveScreenState(bundle);

    expect(state.visibleProblem).toMatch(/FAIL|expected/i);
    expect(screenStateHasTestFailure(state)).toBe(true);
  });
});
