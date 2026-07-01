import { describe, expect, it } from "vitest";
import { buildVisibleAdviceFallback } from "../src/character/proactiveAdviceFallback";

describe("proactiveAdviceFallback", () => {
  it("builds a visible advice line from practical hook", () => {
    const reply = buildVisibleAdviceFallback({
      practicalHook: "проверь импорт в ChatPanel.tsx перед повторным build",
      activeWindow: {
        processName: "Cursor.exe",
        title: "ChatPanel.tsx - desktop-character - Cursor",
      },
    });

    expect(reply).toContain("проверь импорт");
    expect(reply).toContain("Я бы начала");
  });

  it("falls back to active window when hook is absent", () => {
    const reply = buildVisibleAdviceFallback({
      activeWindow: {
        processName: "Cursor.exe",
        title: "README.md - desktop-character - Cursor",
      },
    });

    expect(reply).toContain("README.md");
  });

  it("returns null without any grounding", () => {
    expect(buildVisibleAdviceFallback({})).toBeNull();
  });
});
