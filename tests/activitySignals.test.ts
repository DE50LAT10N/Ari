import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordInputFriction,
  recordClipboardSignal,
  summarizeActivitySignals,
} from "../src/memory/activitySignals";
import { classifyClipboardText } from "../src/platform/clipboard";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import { scoreAdviceUrgency } from "../src/character/adviceUrgency";

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

describe("activitySignals input friction", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
  });

  it("summarizes aggregate typing friction without storing typed text", () => {
    const now = Date.now();
    recordInputFriction({
      frictionKind: "long_pause",
      process: "Cursor.exe",
      title: "advisorEngine.ts - desktop-character - Cursor",
      file: "advisorEngine.ts",
      idleSeconds: 80,
      dwellMs: 8 * 60_000,
      at: now,
    });

    const summary = summarizeActivitySignals(now);
    expect(summary.inputFrictionScore).toBeGreaterThan(0);
    expect(summary.recentInputPauses).toBe(1);
    expect(summary.lastInputFriction?.file).toBe("advisorEngine.ts");
    expect(JSON.stringify(summary)).not.toContain("typed");
  });

  it("raises advice urgency before browser search when IDE friction appears", () => {
    const now = Date.now();
    recordInputFriction({
      frictionKind: "long_pause",
      process: "Cursor.exe",
      title: "advisorEngine.ts - desktop-character - Cursor",
      file: "advisorEngine.ts",
      idleSeconds: 90,
      dwellMs: 10 * 60_000,
      at: now,
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "advisorEngine.ts - desktop-character - Cursor",
      sessionMinutes: 6,
      windowMinutes: 10,
      now,
    });
    const urgency = scoreAdviceUrgency(bundle, defaultSettings, {
      sessionMinutes: 6,
      userIntervalMs: 60_000,
      now,
    });

    expect(urgency.level).not.toBe("none");
    expect(urgency.reasons.join(" ")).toContain("застревание до поиска");
  });

  it("uses keyboard correction churn as a stronger stuck signal without text", () => {
    const now = Date.now();
    recordInputFriction({
      frictionKind: "correction_churn",
      process: "Cursor.exe",
      title: "proactiveEngine.ts - desktop-character - Cursor",
      file: "proactiveEngine.ts",
      dwellMs: 6 * 60_000,
      keyCount: 24,
      correctionCount: 7,
      commandCount: 1,
      burstCount: 1,
      at: now,
    });

    const summary = summarizeActivitySignals(now);
    expect(summary.recentCorrectionChurns).toBe(1);
    expect(summary.inputFrictionScore).toBeGreaterThanOrEqual(1.5);
    expect(JSON.stringify(summary)).not.toContain("password");
  });

  it("recognizes diagnostic clipboard as substantive context", () => {
    expect(classifyClipboardText("npm ERR! Cannot find module vite")).toBe(
      "diagnostic",
    );
    recordClipboardSignal({
      clipKind: "diagnostic",
      snippet: "npm ERR! Cannot find module vite",
    });
    const summary = summarizeActivitySignals();
    expect(summary.clipboardKinds.diagnostic).toBe(1);
    expect(summary.substantiveClipboardCount).toBe(1);
  });

  it("recognizes structured clipboard notation as substantive context", () => {
    const structured = "Input{User message} --> Cmd{Chat command?}";
    expect(classifyClipboardText(structured)).toBe("code");
    recordClipboardSignal({
      clipKind: "text",
      snippet: structured,
    });
    const summary = summarizeActivitySignals();
    expect(summary.substantiveClipboardCount).toBe(1);
  });
});
