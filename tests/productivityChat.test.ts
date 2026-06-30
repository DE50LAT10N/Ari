import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  parsePomodoroStartRequest,
  tryHandleProductivityChatCommand,
} from "../src/chat/productivityChat";
import { invalidateGoalCache } from "../src/tasks/goalLedger";
import { loadPomodoroState } from "../src/character/pomodoro";

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

describe("productivityChat", () => {
  beforeEach(() => {
    setupStorage();
    invalidateGoalCache();
  });

  it("parses pomodoro goal and minutes", () => {
    expect(
      parsePomodoroStartRequest("помодоро 30 мин на отчёт", 25),
    ).toEqual({ goal: "отчёт", minutes: 30 });
  });

  it("starts pomodoro from chat command", () => {
    const result = tryHandleProductivityChatCommand(
      "запусти помодоро 20 мин на рефакторинг",
      defaultSettings,
    );
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply).toContain("20");
    expect(loadPomodoroState().phase).not.toBe("idle");
  });
});
