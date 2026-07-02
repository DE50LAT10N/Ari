import type { CharacterEmotion } from "../../types/character";
import type { MoodTriggerKind } from "../moodTriggers";
import { MOOD_SHIFT_BY_TRIGGER } from "../moodTriggers";
import { EMOTION_MOOD_SHIFTS, INTERACTION_MOOD_SHIFTS } from "../mood";
import type { MoodVector } from "./moodVector";

export type MoodImpactVector = MoodVector;

export type MoodImpactRuleId =
  | `emotion:${CharacterEmotion}`
  | `interaction:${keyof typeof INTERACTION_MOOD_SHIFTS}`
  | `trigger:${MoodTriggerKind}`;

export function resolveImpactRule(id: MoodImpactRuleId): MoodImpactVector {
  if (id.startsWith("emotion:")) {
    const emotion = id.slice("emotion:".length) as CharacterEmotion;
    const shift = EMOTION_MOOD_SHIFTS[emotion];
    return { ...shift };
  }
  if (id.startsWith("interaction:")) {
    const interaction = id.slice("interaction:".length) as keyof typeof INTERACTION_MOOD_SHIFTS;
    const shift = INTERACTION_MOOD_SHIFTS[interaction];
    return { ...shift };
  }
  if (id.startsWith("trigger:")) {
    const trigger = id.slice("trigger:".length) as MoodTriggerKind;
    const shift = MOOD_SHIFT_BY_TRIGGER[trigger];
    return { ...shift };
  }
  // Exhaustive guard
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  throw new Error(`Unknown mood impact rule: ${id}`);
}

