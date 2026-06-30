import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterMood } from "../src/character/mood";
import { buildLiveStatusLine } from "../src/character/liveStatus";
import {
  buildMoodRefusalReply,
  deriveMoodArchetype,
  moodStatusLabel,
  shouldMoodRefuseRequest,
} from "../src/character/moodBehavior";
import { tryHandleTaskChatCommand } from "../src/chat/taskChatParse";
import { tryHandleProductivityChatCommand } from "../src/chat/productivityChat";
import { defaultSettings } from "../src/settings/appSettings";
import { invalidateTaskCache } from "../src/tasks/taskStore";

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

function mood(partial: Partial<CharacterMood>): CharacterMood {
  return {
    warmth: 0.25,
    energy: 0.45,
    irritation: 0,
    updatedAt: Date.now(),
    ...partial,
  };
}

describe("moodBehavior", () => {
  beforeEach(() => {
    setupStorage();
    invalidateTaskCache();
  });
  it("labels playful and irritated archetypes", () => {
    expect(
      moodStatusLabel(
        mood({ warmth: 0.55, energy: 0.65, irritation: 0.05 }),
      ),
    ).toBe("озорная");
    expect(
      moodStatusLabel(mood({ irritation: 0.5, warmth: 0.1, energy: 0.4 })),
    ).toBe("раздражённая");
  });

  it("refuses tasks and pomodoro when irritated", () => {
    const irritated = mood({ irritation: 0.5, warmth: 0.1, energy: 0.4 });
    expect(deriveMoodArchetype(irritated)).toBe("irritated");
    expect(shouldMoodRefuseRequest(irritated, "task")).toBe(true);
    expect(shouldMoodRefuseRequest(irritated, "pomodoro")).toBe(true);
    expect(buildMoodRefusalReply(irritated, "task")).toContain("секретаря");
  });

  it("shows mood in live status line", () => {
    const line = buildLiveStatusLine({
      attention: "listening",
      lifecycle: "awake",
      emotion: "neutral",
      loading: false,
      hasStreamTokens: false,
      mood: mood({ warmth: 0.55, energy: 0.65, irritation: 0.05 }),
    });
    expect(line).toContain("слушает");
    expect(line).toContain("озорная");
  });

  it("blocks task add from chat when irritated", () => {
    const irritated = mood({ irritation: 0.5, warmth: 0.1, energy: 0.4 });
    const result = tryHandleTaskChatCommand(
      "добавь задачу убраться",
      irritated,
    );
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.command).toBe("mood-refusal");
  });

  it("blocks pomodoro start when irritated", () => {
    const irritated = mood({ irritation: 0.5, warmth: 0.1, energy: 0.4 });
    const result = tryHandleProductivityChatCommand(
      "запусти помодоро 25 мин",
      defaultSettings,
      irritated,
    );
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.command).toBe("mood-refusal");
  });
});
