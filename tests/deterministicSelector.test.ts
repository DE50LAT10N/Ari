import { describe, expect, it } from "vitest";
import {
  pickDeterministic,
  resetDeterministicSelectorsForTests,
} from "../src/character/deterministicSelector";

describe("deterministic selector", () => {
  it("rotates alternatives without immediate repeats", () => {
    resetDeterministicSelectorsForTests();
    const items = ["a", "b", "c"];

    expect(pickDeterministic("scenario", items)).toBe("a");
    expect(pickDeterministic("scenario", items)).toBe("b");
    expect(pickDeterministic("scenario", items)).toBe("c");
    expect(pickDeterministic("scenario", items)).toBe("a");
  });

  it("keeps independent cursors per key", () => {
    resetDeterministicSelectorsForTests();

    expect(pickDeterministic("left", [1, 2])).toBe(1);
    expect(pickDeterministic("right", [1, 2])).toBe(1);
    expect(pickDeterministic("left", [1, 2])).toBe(2);
  });
});
