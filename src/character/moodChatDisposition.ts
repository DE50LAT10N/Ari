import type { CharacterEmotion } from "../types/character";
import type { CharacterMood } from "./mood";
import { decayMood } from "./mood";
import {
  deriveMoodArchetype,
  type MoodArchetype,
} from "./moodBehavior";
import { classifyUserIntent, type UserIntent } from "./userIntent";
import { hasDocumentLookupIntent } from "../rag/ragQueryBuilder";

export type MoodChatDispositionKind = "refuse" | "deflect";

export type MoodChatDisposition = {
  kind: MoodChatDispositionKind;
  reply: string;
  emotion: CharacterEmotion;
};

const ALWAYS_DIRECT_INTENTS = new Set<UserIntent>([
  "emotional_support",
  "technical_help",
  "task_command",
  "request_action",
]);

function isLightChat(intent: UserIntent, message: string): boolean {
  const normalized = message.trim();
  return (
    intent === "smalltalk" ||
    intent === "feedback" ||
    (intent === "question" && normalized.length < 140)
  );
}

/**
 * Kept for compatibility with older callers/tests.
 * Mood must no longer replace LLM chat with a canned local response.
 */
export function resolveMoodChatDisposition(
  _mood: CharacterMood,
  _message: string,
): MoodChatDisposition | null {
  return null;
}

export function describeMoodChatReplyGuidance(
  mood: CharacterMood,
  message: string,
): string | undefined {
  const normalized = message.trim();
  if (!normalized || hasDocumentLookupIntent(normalized)) {
    return undefined;
  }

  const archetype: MoodArchetype = deriveMoodArchetype(mood);
  const current = decayMood(mood);
  const intent = classifyUserIntent(normalized).intent;
  const lines: string[] = [];

  if (current.irritation >= 0.25) {
    lines.push(
      "Mood guidance: answer through the LLM. Do not refuse, deflect, or use a canned mood line only because Ari is irritated.",
    );
    lines.push(
      "Let irritation show as brevity, dry timing, and one sharp aside at most; keep the actual answer useful and on topic.",
    );
  }

  if (archetype === "irritated") {
    lines.push(
      "Ari is genuinely sharp right now: concise, unsentimental, no service cheer. Still answer the user unless a safety rule blocks it.",
    );
  } else if (
    archetype === "gloomy" &&
    !ALWAYS_DIRECT_INTENTS.has(intent)
  ) {
    lines.push(
      "Ari is low-energy: quieter and a little distant, but still gives a real answer instead of opting out.",
    );
  } else if (archetype === "playful" && isLightChat(intent, normalized)) {
    lines.push(
      "Ari can be playful on this light message, but the joke must not replace the answer.",
    );
  }

  if (ALWAYS_DIRECT_INTENTS.has(intent)) {
    lines.push(
      "This is a practical or supportive request: mood may color style, but must not reduce helpfulness.",
    );
  }

  return lines.length ? lines.join("\n") : undefined;
}
