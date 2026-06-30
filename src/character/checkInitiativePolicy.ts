import { allowsGenericCompanionInitiative } from "./initiativeConfig";

export type ProactiveTickAction =
  | "silent"
  | "try_advice"
  | "retry_advice_later"
  | "try_presence";

export function evaluateProactiveTick(input: {
  adviceReady: boolean;
  presenceReady: boolean;
  idleGateOpen: boolean;
  loading?: boolean;
}): ProactiveTickAction {
  if (input.loading || !input.idleGateOpen) {
    return "silent";
  }
  if (!input.adviceReady && !input.presenceReady) {
    return "silent";
  }
  if (input.adviceReady) {
    return "try_advice";
  }
  return "try_presence";
}

export function afterAdviceAttempt(input: {
  adviceSent: boolean;
  presenceReady: boolean;
}): ProactiveTickAction {
  if (input.adviceSent) {
    return "silent";
  }
  if (!input.presenceReady) {
    return "retry_advice_later";
  }
  return "try_presence";
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
