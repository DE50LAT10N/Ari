import { describe, expect, it } from "vitest";
import { deriveLifecycleState } from "../src/character/lifecycle";

describe("lifecycle", () => {
  it("keeps awake at night when nightBehavior is normal", () => {
    expect(
      deriveLifecycleState(120, 23, "off", false, "normal"),
    ).toBe("awake");
  });

  it("enters sleepy at night when nightBehavior is quiet", () => {
    expect(
      deriveLifecycleState(120, 23, "off", false, "quiet"),
    ).toBe("sleepy");
  });
});
