import type { MoodVector } from "./moodVector";
import type { MoodClassificationResult } from "./moodClassifier";
import { classifyMood } from "./moodClassifier";
import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";
import { describeMoodForPrompt } from "../mood";
import { toCharacterMood } from "./moodVector";

export type MoodStyleAdapterResult = {
  promptModifier: string;
  emotion: MoodClassificationResult["emotion"];
  archetype: MoodClassificationResult["archetype"];
  classification: MoodClassificationResult;
  /**
   * Optional output knobs for the reply pipeline.
   * These must never change safety, facts, refusals, permissions, tool access, or privacy behavior.
   */
  responseParams: {
    preferredReplyLength?: "short" | "normal";
    preferClarifyingTone?: boolean;
  };
};

export function adaptMoodToStyle(
  vector: MoodVector,
  input: { axisConfig?: MoodAxisConfigTable; now?: number } = {},
): MoodStyleAdapterResult {
  const now = input.now ?? Date.now();
  const axisConfig = input.axisConfig ?? DEFAULT_MOOD_AXES;
  const classification = classifyMood(vector, { axisConfig, now });

  // Keep prompt continuity by reusing existing, battle-tested mood prompt block.
  // Safety invariant: this modifier affects only style/tone/tempo/emotion hints.
  const legacyMood = toCharacterMood(vector, now, axisConfig);
  const promptModifier = describeMoodForPrompt(legacyMood);

  const responseParams: MoodStyleAdapterResult["responseParams"] = {};
  if (vector.energy !== undefined && vector.energy < 0.35) {
    responseParams.preferredReplyLength = "short";
  }
  if (vector.irritation !== undefined && vector.irritation > 0.25) {
    responseParams.preferClarifyingTone = true;
  }

  return {
    promptModifier,
    emotion: classification.emotion,
    archetype: classification.archetype,
    classification,
    responseParams,
  };
}

