import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS,
  proactiveSmalltalkIntervalMs,
} from "../src/character/initiativeConfig";
import {
  canEmitSmalltalkNow,
  markAdviceAttemptAt,
  proactiveCrossChannelGapMs,
} from "../src/character/proactiveState";
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
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("proactive pacing targets", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("fits multiple smalltalk windows in 10 minutes on active initiative", () => {
    const settings = {
      ...defaultSettings,
      initiativeLevel: "active" as const,
      proactiveSmalltalkIntervalMinutes: 10,
    };
    const interval = proactiveSmalltalkIntervalMs(settings);
    const gap = proactiveCrossChannelGapMs(settings);
    const tenMinutes = 10 * 60_000;

    expect(interval).toBe(10 * 60_000 * 0.35);
    expect(Math.floor(tenMinutes / interval)).toBeGreaterThanOrEqual(2);
    expect(gap).toBeLessThan(interval);
  });

  it("allows smalltalk after advice within active cross-channel gap", () => {
    const now = 5_000_000;
    const active = { initiativeLevel: "active" as const };
    markAdviceAttemptAt(now);
    expect(canEmitSmalltalkNow(active, now + 60_000)).toBe(false);
    expect(canEmitSmalltalkNow(active, now + 90_000)).toBe(true);
  });

  it("uses short idle gate for active open-chat smalltalk", () => {
    expect(ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS).toBe(45_000);
  });
});
