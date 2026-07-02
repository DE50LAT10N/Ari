import { describe, expect, it } from "vitest";
import {
  buildVisibleAdviceFallback,
  buildVisibleClarifyingFallback,
} from "../src/character/proactiveAdviceFallback";
import { buildFileClarifyingQuestion } from "../src/character/proactiveLlmEngine";

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

  it("does not duplicate clarifying hook text", () => {
    const hook =
      "В буфере «так далеко не уйдём» — это текущая отладка или просто пример? Уточни, и я дам точный следующий шаг.";
    const reply = buildVisibleAdviceFallback({ practicalHook: hook });
    expect(reply).toContain("буфере");
    expect(reply?.split("В буфере").length).toBe(2);
    expect(reply).not.toContain("Я бы начала с одного шага");
  });

  it("builds varied clarifying fallback for file context", () => {
    const reply = buildVisibleClarifyingFallback(
      [
        {
          id: "file:CHANGELOG.md",
          kind: "file",
          label: "Файл в IDE",
          detail: "CHANGELOG.md",
        },
      ],
      null,
    );

    expect(reply).toContain("CHANGELOG.md");
    expect(reply).toMatch(/\?/);
    expect(reply).toContain(buildFileClarifyingQuestion("CHANGELOG.md"));
  });
});
