import { describe, expect, it } from "vitest";
import {
  afterAdviceAttempt,
  companionSilenceGateReady,
  evaluateProactiveTick,
} from "../src/character/checkInitiativePolicy";
import { allowsGenericCompanionInitiative } from "../src/character/initiativeConfig";

describe("checkInitiativePolicy", () => {
  it("stays silent when neither advice nor smalltalk is ready", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: false,
        smalltalkReady: false,
        idleGateOpen: true,
      }),
    ).toBe("silent");
  });

  it("prefers advice when only advice slot is ready", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: false,
        idleGateOpen: true,
        adviceUrgencyLevel: "medium",
      }),
    ).toBe("try_advice");
  });

  it("prefers advice on a fresh low-urgency slot when both are ready", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "low",
      }),
    ).toBe("try_advice");
  });

  it("lets low-urgency advice through when smalltalk is dominating the day", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "low",
        smalltalkSkewedToday: true,
      }),
    ).toBe("try_advice");
  });

  it("prefers advice when no advice today and smalltalk skewed despite streak", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "low",
        recentAdviceStreak: 1,
        smalltalkSkewedToday: true,
        adviceToday: 0,
      }),
    ).toBe("try_advice");
  });

  it("prefers advice at medium urgency even after a recent advice streak", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "medium",
        recentAdviceStreak: 2,
      }),
    ).toBe("try_advice");
  });

  it("still allows urgent advice before a long streak", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "high",
        recentAdviceStreak: 1,
      }),
    ).toBe("try_advice");
  });

  it("falls back to smalltalk when urgent advice has already repeated too much", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "high",
        recentAdviceStreak: 3,
      }),
    ).toBe("try_smalltalk");
  });

  it("prefers advice at medium urgency even when advice is skewed today", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "medium",
        adviceSkewedToday: true,
      }),
    ).toBe("try_advice");
  });

  it("prefers smalltalk after one low-urgency advice in the streak", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        adviceUrgencyLevel: "low",
        recentAdviceStreak: 1,
      }),
    ).toBe("try_smalltalk");
  });

  it("uses smalltalk when only smalltalk slot is ready", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: false,
        smalltalkReady: true,
        idleGateOpen: true,
      }),
    ).toBe("try_smalltalk");
  });

  it("blocks ticks while loading or idle gate is closed", () => {
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: false,
        loading: false,
      }),
    ).toBe("silent");
    expect(
      evaluateProactiveTick({
        adviceReady: true,
        smalltalkReady: true,
        idleGateOpen: true,
        loading: true,
      }),
    ).toBe("silent");
  });

  it("backs off advice when it failed and smalltalk is not ready", () => {
    expect(
      afterAdviceAttempt({ adviceSent: false, smalltalkReady: false }),
    ).toBe("retry_advice_later");
    expect(afterAdviceAttempt({ adviceSent: true, smalltalkReady: false })).toBe(
      "silent",
    );
    expect(
      afterAdviceAttempt({ adviceSent: false, smalltalkReady: true }),
    ).toBe("try_smalltalk");
  });

  it("does not replace failed medium or high advice with smalltalk", () => {
    expect(
      afterAdviceAttempt({
        adviceSent: false,
        smalltalkReady: true,
        adviceUrgencyLevel: "medium",
      }),
    ).toBe("retry_advice_later");
    expect(
      afterAdviceAttempt({
        adviceSent: false,
        smalltalkReady: true,
        adviceUrgencyLevel: "high",
      }),
    ).toBe("retry_advice_later");
    expect(
      afterAdviceAttempt({
        adviceSent: false,
        smalltalkReady: true,
        adviceUrgencyLevel: "low",
      }),
    ).toBe("try_smalltalk");
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
