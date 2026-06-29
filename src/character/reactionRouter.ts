import type { CharacterEmotion } from "../types/character";
import type { MicroReaction, PresenceScene } from "./presence";
import {
  getPcReactionVisualDuration,
  type PcReactionPlan,
} from "./pcReactionCatalog";
import {
  getSilentReaction,
  type SilentReactionKind,
} from "./silentReactions";
import {
  overlayDurationMs,
  REACTION_AMBIENT_MS,
} from "./reactionTiming";

export type MicroReactionPayload = MicroReaction;

export function buildSilentMicroReaction(
  kind: SilentReactionKind,
  scene: PresenceScene,
): MicroReactionPayload | null {
  const reaction = getSilentReaction(kind, scene);
  if (!reaction) {
    return null;
  }
  return {
    id: Date.now(),
    type: reaction.overlay ?? "thinking",
    emotion: reaction.emotion,
    thought: reaction.thought,
    durationMs:
      reaction.durationMs ?? overlayDurationMs(reaction.overlay ?? "thinking"),
  };
}

export function buildPcMicroReaction(plan: PcReactionPlan): MicroReactionPayload {
  return {
    id: Date.now(),
    type: plan.overlay,
    emotion: plan.emotion,
    thought: plan.thought,
    durationMs: getPcReactionVisualDuration(plan),
  };
}

export function ambientEmotionDurationMs(
  reaction: MicroReactionPayload,
): number {
  return reaction.durationMs ?? REACTION_AMBIENT_MS;
}

export function reactionEmotion(
  reaction: MicroReactionPayload,
): CharacterEmotion {
  return reaction.emotion ?? "neutral";
}
