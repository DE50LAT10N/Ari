import { describe, expect, it } from "vitest";
import {
  afterAdviceAttempt,
  companionSilenceGateReady,
  evaluateProactiveTick,
} from "../src/character/checkInitiativePolicy";
import { allowsGenericCompanionInitiative } from "../src/character/initiativeConfig";

describe("checkInitiativePolicy", () => {
  it("stays silent when neither advice nor presence is ready", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: false,
        presenceReady: false,
        idleGateOpen: true,
      }),
    ).toBe("silent");
  });

  it("prefers advice when advice slot is ready", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        presenceReady: true,
        idleGateOpen: true,
      }),
    ).toBe("try_advice");
  });

  it("uses presence when only presence slot is ready", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: false,
        presenceReady: true,
        idleGateOpen: true,
      }),
    ).toBe("try_presence");
  });

  it("blocks ticks while loading or idle gate is closed", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        presenceReady: true,
        idleGateOpen: false,
        loading: false,
      }),
    ).toBe("silent");
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        presenceReady: true,
        idleGateOpen: true,
        loading: true,
      }),
    ).toBe("silent");
  });

  it("backs off advice when it failed and presence is not ready", () => {
    expect(
      afterAdviceAttempt({ adviceSent: false, presenceReady: false }),
    ).toBe("retry_advice_later");
    expect(afterAdviceAttempt({ adviceSent: true, presenceReady: false })).toBe(
      "silent",
    );
    expect(
      afterAdviceAttempt({ adviceSent: false, presenceReady: true }),
    ).toBe("try_presence");
  });

  it("allows immersed generic check-in via companion silence", () => {
    expect(
      allowsGenericCompanionInitiative(30_000, 120_000, {
        immersedCompanion: true,
        companionSilenceMs: 13 * 60_000,
        companionSilenceMinMs: 12 * 60_000,
      }),
    ).toBe(true);
    expect(
      allowsGenericCompanionInitiative(30_000, 120_000, {
        immersedCompanion: false,
      }),
    ).toBe(false);
    expect(
      companionSilenceGateReady({
        activityAgoMs: 30_000,
        plannedSilenceMs: 120_000,
        immersedCompanion: true,
        companionSilenceMs: 13 * 60_000,
        companionSilenceMinMs: 12 * 60_000,
      }),
    ).toBe(true);
  });
});
