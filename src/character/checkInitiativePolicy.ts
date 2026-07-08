import type { AdviceUrgencyLevel } from "./adviceUrgency";
import {
  PROACTIVE_MIN_RECENT_ADVICE_COOLDOWN_MS,
  PROACTIVE_RECENT_ADVICE_COOLDOWN_FACTOR,
} from "./proactivePolicyConfig";

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
    sinceAdviceAttemptMs <
      Math.max(
        adviceCooldownMs * PROACTIVE_RECENT_ADVICE_COOLDOWN_FACTOR,
        PROACTIVE_MIN_RECENT_ADVICE_COOLDOWN_MS,
      );

  if (
    input.adviceReady &&
    (input.adviceUrgencyLevel === "medium" ||
      (input.adviceUrgencyLevel === "high" && streak < 3))
  ) {
    return "try_advice";
  }

  if (
    smalltalkReady &&
    input.adviceReady &&
    input.adviceUrgencyLevel === "low" &&
    (streak >= 1 || skewed)
  ) {
    if (recentAdviceCooldown) {
      return "silent";
    }
    return "try_smalltalk";
  }

  if (
    smalltalkReady &&
    input.adviceReady &&
    input.adviceUrgencyLevel === "high" &&
    streak >= 3
  ) {
    if (recentAdviceCooldown) {
      return "silent";
    }
    return "try_smalltalk";
  }

  if (input.adviceReady) {
    return "try_advice";
  }

  if (smalltalkReady) {
    if (recentAdviceCooldown) {
      return "silent";
    }
    return "try_smalltalk";
  }

  return "silent";
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
