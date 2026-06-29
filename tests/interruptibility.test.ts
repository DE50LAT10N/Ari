import { describe, expect, it } from "vitest";
import {
  allowsInitiative,
  allowsInitiativeForKind,
  deriveInterruptibility,
} from "../src/character/interruptibility";

const baseInput = {
  lifecycle: "awake" as const,
  focusSessionActive: false,
  bodyDoubling: false,
  pomodoroPhase: "idle" as const,
  chatOpen: false,
  generationInProgress: false,
  quietModeActive: false,
  typingIdleSeconds: 120,
  recentIgnoredInitiatives: 0,
};

describe("interruptibility", () => {
  it("blocks generic initiatives during focus+pomodoro", () => {
    const tier = deriveInterruptibility({
      ...baseInput,
      focusSessionActive: true,
      pomodoroPhase: "focus",
    });
    expect(tier).toBe("silent_only");
    expect(allowsInitiative(tier)).toBe(false);
    expect(allowsInitiativeForKind(tier, "check_in")).toBe(false);
  });

  it("allows distraction_nudge during focus+pomodoro silent_only", () => {
    const tier = deriveInterruptibility({
      ...baseInput,
      focusSessionActive: true,
      pomodoroPhase: "focus",
    });
    expect(allowsInitiativeForKind(tier, "distraction_nudge")).toBe(true);
  });

  it("allows distraction_nudge at low_priority_ok (pomodoro only)", () => {
    const tier = deriveInterruptibility({
      ...baseInput,
      pomodoroPhase: "focus",
    });
    expect(tier).toBe("low_priority_ok");
    expect(allowsInitiativeForKind(tier, "distraction_nudge")).toBe(true);
  });
});
