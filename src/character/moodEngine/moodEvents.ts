import { clamp } from "../../platform/mathUtils";
import type { CharacterEmotion } from "../../types/character";
import type { MoodTrigger } from "../moodTriggers";
import type { MoodImpactRuleId, MoodImpactVector } from "./impactRules";

export type MoodEventSource =
  | "user_message"
  | "assistant_reply"
  | "ui_interaction"
  | "proactive"
  | "system";

export type MoodEvent = {
  id: string;
  type: string;
  source: MoodEventSource;
  intensity: number;
  confidence: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
  impact?: MoodImpactVector;
  impactRuleId?: MoodImpactRuleId;
};

function clampIntensity(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return clamp(value, 0, 2);
}

export function emotionToMoodEvent(input: {
  emotion: CharacterEmotion;
  timestamp?: number;
  intensity?: number;
  confidence?: number;
  source?: MoodEventSource;
  metadata?: Record<string, unknown>;
}): MoodEvent {
  const timestamp = input.timestamp ?? Date.now();
  return {
    id: `emotion:${input.emotion}:${timestamp}`,
    type: "emotion",
    source: input.source ?? "assistant_reply",
    intensity: clampIntensity(input.intensity ?? 1),
    confidence: clampIntensity(input.confidence ?? 1),
    timestamp,
    metadata: input.metadata,
    impactRuleId: `emotion:${input.emotion}`,
  };
}

export function interactionToMoodEvent(input: {
  interaction:
    | "click"
    | "repeated-clicks"
    | "return"
    | "headpat"
    | "chat_positive"
    | "help_request"
    | "ignored_initiative"
    | "long_silence";
  timestamp?: number;
  intensity?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}): MoodEvent {
  const timestamp = input.timestamp ?? Date.now();
  return {
    id: `interaction:${input.interaction}:${timestamp}`,
    type: "interaction",
    source: "ui_interaction",
    intensity: clampIntensity(input.intensity ?? 1),
    confidence: clampIntensity(input.confidence ?? 1),
    timestamp,
    metadata: input.metadata,
    impactRuleId: `interaction:${input.interaction}`,
  };
}

export function triggerToMoodEvent(input: {
  trigger: MoodTrigger;
  timestamp?: number;
  intensity?: number;
  metadata?: Record<string, unknown>;
}): MoodEvent | null {
  const timestamp = input.timestamp ?? Date.now();
  const confidence = input.trigger.confidence;
  if (input.trigger.kind === "neutral" || confidence < 0.58) {
    return null;
  }
  return {
    id: `trigger:${input.trigger.kind}:${timestamp}`,
    type: "trigger",
    source: "user_message",
    intensity: clampIntensity(input.intensity ?? 1),
    confidence: clampIntensity(confidence),
    timestamp,
    metadata: { ...input.metadata, kind: input.trigger.kind },
    impactRuleId: `trigger:${input.trigger.kind}`,
  };
}

