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
  smalltalkSkewedToday?: boolean;
  adviceToday?: number;
  sinceAdviceAttemptMs?: number;
  adviceCooldownMs?: number;
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
  const adviceCooldownMs = input.adviceCooldownMs ?? 0;
  const sinceAdviceAttemptMs = input.sinceAdviceAttemptMs ?? Number.POSITIVE_INFINITY;
  const recentAdviceCooldown =
    streak >= 1 &&
    adviceCooldownMs > 0 &&
    sinceAdviceAttemptMs < Math.max(adviceCooldownMs * 0.55, 90_000);
  if (
    input.adviceReady &&
    (input.adviceUrgencyLevel === "medium" ||
      (input.adviceUrgencyLevel === "high" && streak < 3))
  ) {
    return "try_advice";
  }
  if (
    input.adviceReady &&
    input.smalltalkReady &&
    input.adviceUrgencyLevel === "low" &&
    input.smalltalkSkewedToday
  ) {
    return "try_advice";
  }
  if (
    smalltalkReady &&
    (!input.adviceReady ||
      input.adviceUrgencyLevel === "none" ||
      (input.adviceUrgencyLevel === "low" && (streak >= 1 || skewed)) ||
      (input.adviceUrgencyLevel === "high" && streak >= 3))
  ) {
    if (recentAdviceCooldown) {
      return "silent";
    }
    if (
      input.adviceReady &&
      (input.adviceToday ?? 0) === 0 &&
      input.smalltalkSkewedToday
    ) {
      return "try_advice";
    }
    return "try_smalltalk";
  }
  if (input.adviceReady) {
    return "try_advice";
  }
  if (recentAdviceCooldown) {
    return "silent";
  }
  return "try_smalltalk";
}

export function afterAdviceAttempt(input: {
  adviceSent: boolean;
  smalltalkReady: boolean;
  adviceUrgencyLevel?: AdviceUrgencyLevel;
}): ProactiveTickAction {
  if (input.adviceSent) {
    return "silent";
  }
  if (!input.smalltalkReady) {
    return "retry_advice_later";
  }
  if (
    input.adviceUrgencyLevel === "medium" ||
    input.adviceUrgencyLevel === "high"
  ) {
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
