import type { ChatMessage } from "../types/chat";
import { isCharacterEmotion } from "../types/character";
import {
  parseEmotionFromContent,
  stripEmotionMarkup,
} from "../character/emotionTags";
import { isSafeActionProposal } from "../tools/safeActions";
import { isValidMessageReaction } from "../character/messageReactions";

const HISTORY_KEY = "desktop-character.chat-history.v1";
const MAX_STORED_MESSAGES = 200;

function normalizeSources(value: unknown): ChatMessage["sources"] {
  if (!Array.isArray(value)) return undefined;
  const sources = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    if (
      typeof source.title !== "string" ||
      typeof source.publisher !== "string" ||
      typeof source.url !== "string" ||
      typeof source.publishedAt !== "number" ||
      !Number.isFinite(source.publishedAt)
    ) return [];
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:") return [];
      return [{
        title: source.title.slice(0, 300),
        publisher: source.publisher.slice(0, 120),
        url: url.toString(),
        publishedAt: source.publishedAt,
      }];
    } catch {
      return [];
    }
  }).slice(0, 3);
  return sources.length ? sources : undefined;
}

function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ChatMessage>;
  const validRole =
    candidate.role === "user" || candidate.role === "assistant";
  if (!validRole || typeof candidate.content !== "string") {
    return null;
  }
  const role = candidate.role as "user" | "assistant";

  const parsedEmotion = parseEmotionFromContent(candidate.content);
  const emotion =
    parsedEmotion ??
    (candidate.emotion && isCharacterEmotion(candidate.emotion)
      ? candidate.emotion
      : undefined);
  const content = stripEmotionMarkup(candidate.content).trim();

  if (!content) {
    return null;
  }
  const action = isSafeActionProposal(candidate.action)
    ? candidate.action.status === "running"
      ? { ...candidate.action, status: "pending" as const, result: undefined }
      : candidate.action
    : undefined;
  const sources = normalizeSources(candidate.sources);

  return {
    role,
    content,
    ...(emotion ? { emotion } : {}),
    ...(action ? { action } : {}),
    ...(candidate.branchId ? { branchId: candidate.branchId } : {}),
    ...(candidate.parentMessageId
      ? { parentMessageId: candidate.parentMessageId }
      : {}),
    ...(candidate.isCanon !== undefined ? { isCanon: candidate.isCanon } : {}),
    ...(candidate.messageId ? { messageId: candidate.messageId } : {}),
    ...(candidate.adviceId ? { adviceId: candidate.adviceId } : {}),
    ...(sources ? { sources } : {}),
    ...(candidate.adviceFeedback === "useful" ||
    candidate.adviceFeedback === "not_now" ||
    candidate.adviceFeedback === "miss" ||
    candidate.adviceFeedback === "too_generic"
      ? { adviceFeedback: candidate.adviceFeedback }
      : {}),
    ...(isValidMessageReaction(candidate.reaction)
      ? { reaction: candidate.reaction }
      : {}),
  };
}

export function loadChatHistory(): ChatMessage[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeChatMessage)
          .filter((message): message is ChatMessage => message !== null)
          .slice(-MAX_STORED_MESSAGES)
      : [];
  } catch {
    return [];
  }
}

export function saveChatHistory(history: ChatMessage[]): void {
  const stableHistory = history
    .filter((message) => message.content.trim().length > 0)
    .slice(-MAX_STORED_MESSAGES);

  localStorage.setItem(HISTORY_KEY, JSON.stringify(stableHistory));
}
