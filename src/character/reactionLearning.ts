import type { ChatMessage } from "../types/chat";
import type { AdviceFeedback, AdviceLedgerEntry } from "./adviceLedger";
import { updateAdviceFeedback } from "./adviceLedger";
import { recordAdviceFeedbackOutcome } from "./adviceOutcome";
import {
  type MessageReaction,
  reactionSentiment,
} from "./messageReactions";
import { recordRelevanceFeedback } from "./relevanceRanker";
import {
  applyReactionToSelfMemory,
  type AriSelfMemory,
  loadAriSelfMemory,
} from "./selfMemory";

const EVENTS_KEY = "desktop-character.reaction-learning.v1";
const MAX_EVENTS = 48;

export type ReactionLearningEvent = {
  at: number;
  emoji: MessageReaction;
  messageId?: string;
  adviceId?: string;
  excerpt: string;
  emotion?: string;
  adviceFeedback?: AdviceFeedback;
};

export type ReactionLearningResult = {
  selfMemory: AriSelfMemory;
  adviceEntry?: AdviceLedgerEntry;
  adviceFeedback?: AdviceFeedback;
};

function compactExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

function readEvents(): ReactionLearningEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed as ReactionLearningEvent[]).slice(0, MAX_EVENTS)
      : [];
  } catch {
    return [];
  }
}

function appendEvent(event: ReactionLearningEvent): void {
  const events = [event, ...readEvents()].slice(0, MAX_EVENTS);
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

export function reactionToAdviceFeedback(
  emoji: MessageReaction,
): AdviceFeedback | null {
  switch (emoji) {
    case "👍":
    case "❤️":
    case "😂":
      return "useful";
    case "😢":
      return "not_now";
    case "👎":
      return "miss";
    case "😮":
      return "too_generic";
    default:
      return null;
  }
}

export function getDislikedReplyExcerpts(limit = 6): string[] {
  return readEvents()
    .filter((event) => reactionSentiment(event.emoji) === "negative")
    .map((event) => event.excerpt)
    .filter(Boolean)
    .slice(0, limit);
}

export function describeReactionLearningSummary(): string {
  const events = readEvents().slice(0, 12);
  if (!events.length) {
    return "";
  }

  const positive = events.filter(
    (event) => reactionSentiment(event.emoji) === "positive",
  ).length;
  const negative = events.filter(
    (event) => reactionSentiment(event.emoji) === "negative",
  ).length;
  const empathy = events.filter((event) => event.emoji === "😢").length;
  const parts: string[] = [];

  if (positive >= 2) {
    parts.push("недавние реакции чаще положительные — держи этот стиль");
  }
  if (negative >= 2) {
    parts.push("недавние 👎 — меньше похожих реплик и без навязчивых вопросов в конце");
  }
  if (empathy >= 1) {
    parts.push("😢 — больше мягкой эмпатии, меньше давления");
  }

  const latestNegative = events.find(
    (event) => reactionSentiment(event.emoji) === "negative",
  );
  if (latestNegative) {
    parts.push(`не заходило: «${latestNegative.excerpt.slice(0, 72)}»`);
  }

  const latestPositive = events.find(
    (event) => reactionSentiment(event.emoji) === "positive",
  );
  if (latestPositive && parts.length < 3) {
    parts.push(`зашло: «${latestPositive.excerpt.slice(0, 72)}»`);
  }

  return parts.slice(0, 3).join(". ");
}

export function recordReactionLearning(input: {
  emoji: MessageReaction;
  message: ChatMessage;
}): ReactionLearningResult {
  const excerpt = compactExcerpt(input.message.content);
  const adviceFeedback = input.message.adviceId
    ? reactionToAdviceFeedback(input.emoji)
    : null;
  let adviceEntry: AdviceLedgerEntry | undefined;

  let selfMemory = applyReactionToSelfMemory(
    loadAriSelfMemory(),
    input.emoji,
    input.message.content,
    input.message.emotion ?? "neutral",
  );

  if (input.message.adviceId && adviceFeedback) {
    const updated = updateAdviceFeedback(input.message.adviceId, adviceFeedback);
    if (updated) {
      adviceEntry = updated;
      recordAdviceFeedbackOutcome(updated, adviceFeedback);
      recordRelevanceFeedback(updated, adviceFeedback);
    }
  }

  appendEvent({
    at: Date.now(),
    emoji: input.emoji,
    messageId: input.message.messageId,
    adviceId: input.message.adviceId,
    excerpt,
    emotion: input.message.emotion,
    adviceFeedback: adviceFeedback ?? undefined,
  });

  return {
    selfMemory,
    adviceEntry,
    adviceFeedback: adviceFeedback ?? undefined,
  };
}

export function resetReactionLearningForTests(): void {
  localStorage.removeItem(EVENTS_KEY);
}
