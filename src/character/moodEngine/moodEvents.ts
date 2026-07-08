import { clamp } from "../../platform/mathUtils";
import type { CharacterEmotion } from "../../types/character";
import type { AdviceFeedback } from "../adviceLedger";
import type { MoodTrigger } from "../moodTriggers";
import type { ProactiveReplyTone } from "../proactiveTone";
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

export type ProactiveMoodEventKind =
  | "proactive_sent"
  | "advice_feedback"
  | "advice_ignored";

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

function proactiveImpact(input: {
  kind: ProactiveMoodEventKind;
  tone?: ProactiveReplyTone;
  feedback?: AdviceFeedback;
}): MoodImpactVector {
  if (input.kind === "advice_ignored") {
    return { warmth: -0.12, energy: -0.04, irritation: 0.24 };
  }

  if (input.kind === "advice_feedback") {
    switch (input.feedback) {
      case "useful":
        return { warmth: 0.18, energy: 0.08, irritation: -0.16 };
      case "not_now":
        return { warmth: -0.04, energy: -0.02, irritation: 0.08 };
      case "too_generic":
        return { warmth: -0.08, energy: 0.01, irritation: 0.18 };
      case "miss":
        return { warmth: -0.12, energy: 0.02, irritation: 0.22 };
      default:
        return { warmth: 0, energy: 0, irritation: 0 };
    }
  }

  if (input.tone === "advice") {
    return { warmth: 0.03, energy: 0.08, irritation: -0.02 };
  }
  return { warmth: 0.08, energy: 0.04, irritation: -0.04 };
}

function reactionImpact(emoji: string): MoodImpactVector {
  switch (emoji) {
    case "👍":
    case "❤️":
    case "😂":
      return { warmth: 0.14, energy: 0.06, irritation: -0.12 };
    case "😮":
      return { warmth: 0.05, energy: 0.16, irritation: -0.02 };
    case "😢":
      return { warmth: 0.16, energy: -0.08, irritation: -0.04 };
    case "👎":
      return { warmth: -0.1, energy: 0.02, irritation: 0.2 };
    default:
      return { warmth: 0, energy: 0, irritation: 0 };
  }
}

export function reactionToMoodEvent(input: {
  emoji: string;
  messageId?: string;
  timestamp?: number;
  intensity?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}): MoodEvent {
  const timestamp = input.timestamp ?? Date.now();
  return {
    id: `reaction:${input.emoji}:${input.messageId ?? "message"}:${timestamp}`,
    type: "message_reaction",
    source: "ui_interaction",
    intensity: clampIntensity(input.intensity ?? 0.9),
    confidence: clampIntensity(input.confidence ?? 0.9),
    timestamp,
    metadata: {
      ...input.metadata,
      emoji: input.emoji,
      messageId: input.messageId,
    },
    impact: reactionImpact(input.emoji),
  };
}

export function proactiveToMoodEvent(input: {
  kind: ProactiveMoodEventKind;
  tone?: ProactiveReplyTone;
  feedback?: AdviceFeedback;
  timestamp?: number;
  intensity?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}): MoodEvent {
  const timestamp = input.timestamp ?? Date.now();
  return {
    id: `proactive:${input.kind}:${input.tone ?? input.feedback ?? "none"}:${timestamp}`,
    type: input.kind,
    source: "proactive",
    intensity: clampIntensity(input.intensity ?? 1),
    confidence: clampIntensity(input.confidence ?? 0.82),
    timestamp,
    metadata: {
      ...input.metadata,
      tone: input.tone,
      feedback: input.feedback,
    },
    impact: proactiveImpact(input),
  };
}

export function adviceIgnoredToMoodEvents(count = 1): MoodEvent[] {
  const repeats = Math.min(4, Math.max(1, count));
  return Array.from({ length: repeats }, (_, index) =>
    interactionToMoodEvent({
      interaction: "ignored_initiative",
      intensity: 1,
      metadata: { count: repeats, source: "advice_ignored", repeatIndex: index },
    }),
  );
}

export function assistantIgnoredToMoodEvent(input: {
  messageId: string;
  source: "chat" | "proactive" | "ambient";
  proactive: boolean;
  adviceId?: string;
  ageMs: number;
  ignoredStreak: number;
  timestamp?: number;
}): MoodEvent {
  const timestamp = input.timestamp ?? Date.now();
  const streak = Math.max(1, input.ignoredStreak);
  return {
    id: `assistant-ignored:${input.messageId}:${timestamp}`,
    type: "assistant_ignored",
    source: input.proactive ? "proactive" : "ui_interaction",
    intensity: Math.min(2, 0.95 + (streak - 1) * 0.22),
    confidence: 0.9,
    timestamp,
    metadata: {
      messageId: input.messageId,
      source: input.source,
      proactive: input.proactive,
      adviceId: input.adviceId,
      ageMs: input.ageMs,
      ignoredStreak: streak,
    },
    impact: {
      warmth: -0.2 - Math.min(0.18, (streak - 1) * 0.04),
      energy: -0.08 - Math.min(0.08, (streak - 1) * 0.02),
      irritation: 0.34 + Math.min(0.22, (streak - 1) * 0.06),
    },
  };
}
