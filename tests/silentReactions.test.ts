import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSilentReaction,
  resetSilentReactionStateForTests,
} from "../src/character/silentReactions";

describe("silentReactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-09T10:00:00.000Z"));
    resetSilentReactionStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("avoids immediate thought repeats across cooldown windows", () => {
    const first = getSilentReaction("ambient");
    vi.advanceTimersByTime(8 * 60_000 + 1);
    const second = getSilentReaction("ambient");
    vi.advanceTimersByTime(8 * 60_000 + 1);
    const third = getSilentReaction("ambient");

    expect(first?.thought).toBeTruthy();
    expect(second?.thought).toBeTruthy();
    expect(third?.thought).toBeTruthy();
    expect(second?.thought).not.toBe(first?.thought);
    expect(third?.thought).not.toBe(second?.thought);
  });

  it("uses all options for a reaction kind before reusing one", () => {
    const seen = new Set<string>();

    for (let index = 0; index < 3; index += 1) {
      const reaction = getSilentReaction("return");
      expect(reaction?.thought).toBeTruthy();
      seen.add(reaction!.thought!);
      vi.advanceTimersByTime(10 * 60_000 + 1);
    }

    expect(seen.size).toBe(3);
    const afterCycle = getSilentReaction("return");
    expect(afterCycle?.thought).toBeTruthy();
    expect(afterCycle?.thought).not.toBe([...seen].at(-1));
  });
});
