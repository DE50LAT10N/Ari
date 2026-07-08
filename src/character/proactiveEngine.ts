import type { AppSettings } from "../settings/appSettings";
import type { ProactiveToneSnapshot } from "../memory/memoryTelemetry";
import {
  isAdviceSkewedToday,
} from "../memory/memoryTelemetry";
import type { AdviceUrgency } from "./adviceUrgency";
import {
  hasSubstantiveAdviceSignals,
  shouldAttemptAdviceCycle,
} from "./adviceEngine";
import {
  evaluateProactiveTick,
  type ProactiveTickAction,
} from "./checkInitiativePolicy";
import type { InitiativeSignalBundle } from "./initiativeContext";
import { rankRelevanceCandidates } from "./relevanceRanker";
import { loadMood } from "./mood";
import { deriveMoodPolicy } from "./moodEngine/moodPolicy";
import { fromCharacterMood } from "./moodEngine/moodVector";

export type ProactiveEngineDecision = {
  action: ProactiveTickAction;
  allowSmalltalk: boolean;
  adviceReady: boolean;
  adviceStarved: boolean;
  adviceUrgency: AdviceUrgency;
  reason: string;
  relevanceScores?: string[];
};

export function planProactiveEngineTick(input: {
  settings: AppSettings;
  bundle: InitiativeSignalBundle;
  urgency: AdviceUrgency;
  llmOnline: boolean;
  idleGateOpen: boolean;
  loading: boolean;
  smalltalkReady: boolean;
  sinceAdviceAttemptMs: number;
  adviceIntervalMs: number;
  toneSnapshot: ProactiveToneSnapshot;
  recentAdviceStreak: number;
}): ProactiveEngineDecision {
  const hasActionableSignals = hasSubstantiveAdviceSignals(
    input.bundle,
    input.urgency,
  );
  const adviceStarved =
    input.settings.advisorEnabled &&
    input.llmOnline &&
    hasActionableSignals &&
    input.sinceAdviceAttemptMs >= input.adviceIntervalMs &&
    input.toneSnapshot.adviceToday === 0;

  const adviceReady = shouldAttemptAdviceCycle({
    advisorEnabled: input.settings.advisorEnabled,
    idleGateOpen: input.idleGateOpen,
    loading: input.loading,
    urgency: input.urgency,
    hasActionableSignals,
    adviceStarved,
    sinceAdviceAttemptMs: input.sinceAdviceAttemptMs,
    adviceIntervalMs: input.adviceIntervalMs,
  });

  let action = evaluateProactiveTick({
    adviceReady,
    smalltalkReady: input.smalltalkReady,
    idleGateOpen: input.idleGateOpen,
    loading: input.loading,
    adviceUrgencyLevel: input.urgency.level,
    recentAdviceStreak: input.recentAdviceStreak,
    adviceSkewedToday: isAdviceSkewedToday(input.toneSnapshot),
    adviceToday: input.toneSnapshot.adviceToday,
    sinceAdviceAttemptMs: input.sinceAdviceAttemptMs,
    adviceCooldownMs: input.adviceIntervalMs,
  });
  const policyAction = action;

  const moodPolicy = deriveMoodPolicy(fromCharacterMood(loadMood()));
  if (
    moodPolicy.initiativeBias < 0.38 &&
    (input.urgency.level === "none" || input.urgency.level === "low") &&
    action === "try_advice" &&
    !adviceReady &&
    !adviceStarved
  ) {
    action = input.smalltalkReady ? "try_smalltalk" : "silent";
  }
  if (
    moodPolicy.initiativeBias > 0.68 &&
    action === "silent" &&
    input.smalltalkReady &&
    input.urgency.level !== "high" &&
    !adviceReady
  ) {
    action = "try_smalltalk";
  }

  const protectSmalltalkSlot =
    input.smalltalkReady &&
    input.recentAdviceStreak >= 1 &&
    (input.urgency.level === "none" || input.urgency.level === "low") &&
    !adviceReady;
  if (protectSmalltalkSlot) {
    action = "try_smalltalk";
  }

  let relevanceScores: string[] | undefined;
  if (input.idleGateOpen && !input.loading && !protectSmalltalkSlot) {
    const candidates: Array<"silent" | "try_advice" | "try_smalltalk"> = [
      "silent",
    ];
    if (adviceReady || adviceStarved || input.urgency.level === "high") {
      candidates.push("try_advice");
    }
    if (input.smalltalkReady) {
      candidates.push("try_smalltalk");
    }
    if (candidates.length > 2) {
      const ranked = rankRelevanceCandidates(candidates, {
        bundle: input.bundle,
        urgency: input.urgency,
        llmOnline: input.llmOnline,
        idleGateOpen: input.idleGateOpen,
        loading: input.loading,
        adviceReady,
        smalltalkReady: input.smalltalkReady,
        toneSnapshot: input.toneSnapshot,
        recentAdviceStreak: input.recentAdviceStreak,
      });
      relevanceScores = ranked.map(
        (candidate) => `${candidate.kind}:${candidate.score.toFixed(2)}`,
      );
      const winner = ranked[0]?.kind;
      if (
        winner &&
        winner !== "silent" &&
        !(policyAction === "try_advice" && adviceReady)
      ) {
        action = winner;
      }
    }
  }

  if (adviceStarved && input.idleGateOpen && !input.loading) {
    action = "try_advice";
  }

  const adviceUrgency =
    input.urgency.level === "none" && adviceStarved
      ? {
          ...input.urgency,
          level: "low" as const,
          score: Math.max(input.urgency.score, 1),
          effectiveIntervalMs: input.adviceIntervalMs,
          reasons:
            input.urgency.reasons.length > 0
              ? input.urgency.reasons
              : ["actionable signals, советов сегодня ещё не было"],
        }
      : input.urgency;

  return {
    action,
    allowSmalltalk: action === "try_smalltalk",
    adviceReady,
    adviceStarved,
    adviceUrgency,
    reason: protectSmalltalkSlot
      ? "protected smalltalk timer"
      : adviceStarved && action === "try_advice"
        ? "advice starved"
        : action === "silent"
          ? "no proactive slot"
          : relevanceScores
            ? `ranker ${action}`
            : action,
    relevanceScores,
  };
}
