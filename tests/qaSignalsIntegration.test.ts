import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActivitySignals,
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordFileFocus,
  recordQueryTopic,
  summarizeActivitySignals,
} from "../src/memory/activitySignals";
import { buildCapabilitiesOverview } from "../src/chat/capabilitiesOverview";
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
}

describe("QA signal layer integration", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
  });

  it("stores clipboard kinds and redacts secrets in persisted payload", () => {
    recordClipboardSignal({
      clipKind: "code",
      snippet: "const x = 1;",
    });
    recordClipboardSignal({
      clipKind: "url",
      snippet: "https://example.com/docs",
    });
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "Error: boom\npassword=secret123",
    });

    const raw = localStorage.getItem("desktop-character.activity-signals.v1") ?? "";
    expect(raw).toContain('"clipKind":"code"');
    expect(raw).not.toContain("secret123");
    expect(raw).toContain("[REDACTED]");
    expect(summarizeActivitySignals().clipboardKinds.stacktrace).toBe(1);
  });

  it("records file focus after sufficient dwell", () => {
    recordFileFocus({
      process: "Code.exe",
      file: "auth.ts",
      repo: "desktop-character",
      dwellMs: 6 * 60_000,
    });
    const summary = summarizeActivitySignals();
    expect(summary.dominantFile).toBe("auth.ts");
    expect(summary.dominantRepo).toBe("desktop-character");
    expect(getActivitySignals().some((entry) => entry.kind === "file_focus")).toBe(
      true,
    );
  });

  it("records chat and browser query topics", () => {
    recordQueryTopic({ topic: "useEffect in React", source: "chat" });
    recordQueryTopic({ topic: "react hooks", source: "browser" });
    expect(summarizeActivitySignals().topQueryThemes).toEqual(
      expect.arrayContaining(["useEffect in React", "react hooks"]),
    );
  });

  it("reflects advisor toggles in capabilities overview", () => {
    const on = buildCapabilitiesOverview({
      ...defaultSettings,
      advisorEnabled: true,
      clipboardFullCaptureEnabled: true,
    });
    expect(on).toContain("Programmer advisor (activity signals): on");
    expect(on).toContain("Full clipboard capture (redacted, local): on");

    const off = buildCapabilitiesOverview({
      ...defaultSettings,
      advisorEnabled: false,
      clipboardFullCaptureEnabled: false,
    });
    expect(off).toContain("Programmer advisor (activity signals): off");
    expect(off).toContain("Full clipboard capture (redacted, local): off");
  });
});
