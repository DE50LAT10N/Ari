import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterMood } from "../src/character/mood";
import { buildLiveStatusLine } from "../src/character/liveStatus";
import {
  applyInteractionToMood,
  loadMood,
  applyRepeatedIgnoreMood,
  saveMood,
} from "../src/character/mood";
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
    vi.useRealTimers();
    setupStorage();
    invalidateTaskCache();
  });

  it("labels mood archetypes without overusing playful", () => {
    expect(
      moodStatusLabel(
        mood({ warmth: 0.38, energy: 0.72, irritation: 0.05 }),
      ),
    ).toBe("озорная");
    expect(
      moodStatusLabel(mood({ warmth: 0.34, energy: 0.58, irritation: 0.05 })),
    ).toBe("любопытная");
    expect(
      moodStatusLabel(mood({ warmth: 0.55, energy: 0.65, irritation: 0.05 })),
    ).toBe("тёплая");
    expect(
      moodStatusLabel(mood({ irritation: 0.5, warmth: 0.1, energy: 0.4 })),
    ).toBe("раздражённая");
  });

  it("decays cached mood on repeated load", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-06-30T10:00:00.000Z");
      vi.setSystemTime(now);
      saveMood({
        warmth: 0.25,
        energy: 1,
        irritation: 0,
        updatedAt: now.getTime(),
      });

      const first = loadMood();
      vi.setSystemTime(now.getTime() + 4 * 60 * 60 * 1000);
      const decayed = loadMood();

      expect(first.energy).toBeGreaterThan(0.95);
      expect(decayed.energy).toBeLessThan(first.energy - 0.1);
      expect(decayed.updatedAt).toBe(now.getTime() + 4 * 60 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
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
    expect(line).toContain("тёплая");
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

  it("applies stronger irritation shift when initiative is ignored", () => {
    const base = mood({ warmth: 0.3, energy: 0.4, irritation: 0.1 });
    const afterOnce = applyInteractionToMood(base, "ignored_initiative");
    expect(afterOnce.irritation).toBeGreaterThan(base.irritation + 0.08);
    expect(afterOnce.warmth).toBeLessThan(base.warmth - 0.05);
  });

  it("stacks repeated ignore mood shifts with a cap", () => {
    const base = mood({ warmth: 0.3, energy: 0.4, irritation: 0.1 });
    const afterThree = applyRepeatedIgnoreMood(base, 3);
    expect(afterThree.irritation).toBeGreaterThan(
      applyInteractionToMood(base, "ignored_initiative").irritation,
    );
    expect(afterThree.warmth).toBeLessThan(
      applyInteractionToMood(base, "ignored_initiative").warmth,
    );
  });
});
