import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUseInitiativeKind,
  invalidateInitiativeKindCache,
  markInitiativeKind,
} from "../src/character/initiativeKinds";

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

describe("initiativeKinds", () => {
  beforeEach(() => {
    setupStorage();
    invalidateInitiativeKindCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows planned checks to use the configured interval instead of hidden kind cooldown", () => {
    markInitiativeKind("check_in");

    vi.setSystemTime(new Date("2026-06-28T08:01:00.000Z"));

    expect(canUseInitiativeKind("check_in")).toBe(false);
    expect(canUseInitiativeKind("check_in", { cooldownMs: 60_000 })).toBe(true);
  });
});
