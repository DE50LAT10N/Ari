import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canEmitAdviceNow,
  canEmitSmalltalkNow,
  markAdviceAttemptAt,
  markSmalltalkAttemptAt,
  PROACTIVE_CROSS_CHANNEL_GAP_MS,
} from "../src/character/proactiveState";

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

describe("proactive cross-channel gap", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("blocks smalltalk shortly after advice", () => {
    const now = 1_000_000;
    markAdviceAttemptAt(now);
    expect(canEmitSmalltalkNow(now + 60_000)).toBe(false);
    expect(canEmitSmalltalkNow(now + PROACTIVE_CROSS_CHANNEL_GAP_MS)).toBe(true);
  });

  it("blocks advice shortly after smalltalk", () => {
    const now = 2_000_000;
    markSmalltalkAttemptAt(now);
    expect(canEmitAdviceNow(now + 90_000)).toBe(false);
    expect(canEmitAdviceNow(now + PROACTIVE_CROSS_CHANNEL_GAP_MS)).toBe(true);
  });
});
