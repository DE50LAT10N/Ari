import { allowsGenericCompanionInitiative } from "./initiativeConfig";

import type { AdviceUrgencyLevel } from "./adviceUrgency";

export type ProactiveTickAction =
  | "silent"
  | "try_advice"
  | "retry_advice_later"
  | "try_smalltalk";

export function evaluateProactiveTick(input: {
  adviceReady: boolean;
  smalltalkReady: boolean;
  idleGateOpen: boolean;
  loading?: boolean;
  adviceUrgencyLevel?: AdviceUrgencyLevel;
  recentAdviceStreak?: number;
  adviceSkewedToday?: boolean;
}): ProactiveTickAction {
  if (input.loading || !input.idleGateOpen) {
    return "silent";
  }
  const smalltalkReady = input.smalltalkReady;
  if (!input.adviceReady && !smalltalkReady) {
    return "silent";
  }
  const streak = input.recentAdviceStreak ?? 0;
  const skewed = input.adviceSkewedToday ?? false;
  if (input.adviceUrgencyLevel === "high" && input.adviceReady && streak < 3) {
    return "try_advice";
  }
  if (
    smalltalkReady &&
    (!input.adviceReady ||
      input.adviceUrgencyLevel === "low" ||
      input.adviceUrgencyLevel === "none" ||
      streak >= 1 ||
      skewed)
  ) {
    return "try_smalltalk";
  }
  if (input.adviceReady) {
    return "try_advice";
  }
  return "try_smalltalk";
}

export function afterAdviceAttempt(input: {
  adviceSent: boolean;
  smalltalkReady: boolean;
}): ProactiveTickAction {
  if (input.adviceSent) {
    return "silent";
  }
  if (!input.smalltalkReady) {
    return "retry_advice_later";
  }
  return "try_smalltalk";
}

export function companionSilenceGateReady(input: {
  activityAgoMs: number;
  plannedSilenceMs: number;
  immersedCompanion: boolean;
  companionSilenceMs: number;
  companionSilenceMinMs: number;
}): boolean {
  return allowsGenericCompanionInitiative(
    input.activityAgoMs,
    input.plannedSilenceMs,
    {
      immersedCompanion: input.immersedCompanion,
      companionSilenceMs: input.companionSilenceMs,
      companionSilenceMinMs: input.companionSilenceMinMs,
    },
  );
}
