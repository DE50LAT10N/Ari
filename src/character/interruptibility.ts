import type { InitiativeKind } from "./initiativeKinds";
import type { LifecycleState } from "./lifecycle";
import type { PomodoroPhase } from "./pomodoro";

export type Interruptibility =
  | "do_not_interrupt"
  | "silent_only"
  | "low_priority_ok"
  | "normal"
  | "urgent_only";

export type InterruptibilityInput = {
  lifecycle: LifecycleState;
  focusSessionActive: boolean;
  bodyDoubling: boolean;
  pomodoroPhase: PomodoroPhase;
  chatOpen: boolean;
  generationInProgress: boolean;
  quietModeActive: boolean;
  typingIdleSeconds: number;
  recentIgnoredInitiatives: number;
};

export function deriveInterruptibility(
  input: InterruptibilityInput,
): Interruptibility {
  if (input.bodyDoubling) {
    return "do_not_interrupt";
  }

  if (input.lifecycle === "dnd") {
    return "do_not_interrupt";
  }

  if (input.generationInProgress) {
    return "silent_only";
  }

  if (input.focusSessionActive && input.pomodoroPhase === "focus") {
    return "silent_only";
  }

  if (input.quietModeActive) {
    return "silent_only";
  }

  if (input.lifecycle === "sleeping") {
    return "urgent_only";
  }

  if (input.lifecycle === "sleepy") {
    return "urgent_only";
  }

  if (input.pomodoroPhase === "focus") {
    return "low_priority_ok";
  }

  if (input.chatOpen && input.typingIdleSeconds < 30) {
    return "low_priority_ok";
  }

  if (input.recentIgnoredInitiatives >= 2) {
    return "low_priority_ok";
  }

  return "normal";
}

export function describeInterruptibility(tier: Interruptibility): string {
  return {
    do_not_interrupt: "не беспокоить",
    silent_only: "только тихие реакции",
    low_priority_ok: "низкий приоритет",
    normal: "обычный",
    urgent_only: "только срочное",
  }[tier];
}

export function allowsInitiative(tier: Interruptibility): boolean {
  return tier === "normal" || tier === "low_priority_ok";
}

/** Per-kind gates: distraction nudge may fire during focus+pomodoro (silent_only). */
export function allowsInitiativeForKind(
  tier: Interruptibility,
  kind?: InitiativeKind,
): boolean {
  if (allowsInitiative(tier)) {
    return true;
  }
  if (kind === "distraction_nudge" && tier === "silent_only") {
    return true;
  }
  return false;
}

export function canEmitProactiveReply(
  tier: Interruptibility,
  kind: InitiativeKind = "check_in",
): boolean {
  return allowsInitiativeForKind(tier, kind);
}

export function allowsReminder(tier: Interruptibility): boolean {
  return tier === "normal" || tier === "urgent_only";
}

export function allowsProactiveChat(tier: Interruptibility): boolean {
  return tier === "normal";
}
