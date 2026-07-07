import { describe, expect, it } from "vitest";
import { KEYBOARD_ACTIVITY_CONFIG } from "../src/platform/keyboardActivity";

describe("keyboard activity config", () => {
  it("keeps keyboard friction thresholds named and calibratable", () => {
    expect(KEYBOARD_ACTIVITY_CONFIG.pollIntervalMs).toBeGreaterThan(0);
    expect(KEYBOARD_ACTIVITY_CONFIG.minWindowDwellMs).toBeGreaterThan(
      KEYBOARD_ACTIVITY_CONFIG.pollIntervalMs,
    );
    expect(KEYBOARD_ACTIVITY_CONFIG.correctionChurnMin).toBeGreaterThan(1);
    expect(KEYBOARD_ACTIVITY_CONFIG.commandLoopMin).toBeGreaterThan(1);
    expect(KEYBOARD_ACTIVITY_CONFIG.printableBurstMin).toBeGreaterThan(
      KEYBOARD_ACTIVITY_CONFIG.commandLoopMin,
    );
  });
});
