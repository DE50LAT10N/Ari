import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCompanionSilenceMs,
  recordCompanionInteraction,
} from "../src/platform/userActivity";

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
}

describe("companionSilence", () => {
  beforeEach(() => {
    setupStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));
  });

  it("tracks silence since last companion interaction", () => {
    recordCompanionInteraction();
    vi.advanceTimersByTime(5 * 60_000);
    expect(getCompanionSilenceMs()).toBe(5 * 60_000);
    recordCompanionInteraction();
    expect(getCompanionSilenceMs()).toBe(0);
  });

  it("meets immersed companion threshold after twelve minutes", () => {
    recordCompanionInteraction();
    vi.advanceTimersByTime(12 * 60_000);
    expect(getCompanionSilenceMs()).toBeGreaterThanOrEqual(12 * 60_000);
  });
});
