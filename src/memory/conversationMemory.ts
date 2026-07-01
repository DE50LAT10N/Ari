import type { CharacterEmotion } from "../types/character";

export type ConversationMemoryKind =
  | "topic"
  | "preference"
  | "positive_signal"
  | "negative_signal"
  | "open_thread";

export type ConversationMemoryEntry = {
  id: string;
  kind: ConversationMemoryKind;
  text: string;
  at: number;
};

const STORAGE_KEY = "desktop-character.conversation-memory.v1";
const TTL_MS = 36 * 60 * 60 * 1000;
const MAX_ENTRIES = 24;

function compact(text: string, limit = 220): string {
  return text.trim().replace(/\s+/g, " ").slice(0, limit);
}

function loadRaw(now = Date.now()): ConversationMemoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is ConversationMemoryEntry =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as ConversationMemoryEntry).id === "string" &&
          typeof (entry as ConversationMemoryEntry).kind === "string" &&
          typeof (entry as ConversationMemoryEntry).text === "string" &&
          typeof (entry as ConversationMemoryEntry).at === "number",
      )
      .filter((entry) => now - entry.at < TTL_MS)
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

function saveRaw(entries: ConversationMemoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
}

function pushEntry(kind: ConversationMemoryKind, text: string, at = Date.now()): void {
  const normalized = compact(text);
  if (normalized.length < 4) {
    return;
  }
  const entries = loadRaw(at);
  const last = entries[entries.length - 1];
  if (
    last &&
    last.kind === kind &&
    last.text.toLowerCase() === normalized.toLowerCase() &&
    at - last.at < 10 * 60_000
  ) {
    return;
  }
  entries.push({
    id: crypto.randomUUID(),
    kind,
    text: normalized,
    at,
  });
  saveRaw(entries);
}

function isTinySocialMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.length <= 28 &&
    /^(ок|окей|ага|угу|да|нет|лол|хаха|спасибо|пасиб|ясно|понял|поняла|круто|nice|thanks)[.!?]*$/i.test(
      normalized,
    )
  );
}

function hasDurableMemorySignal(text: string): boolean {
  return /(?:запомни|запиши|сохрани|не забудь|я обычно|я всегда|я часто|я предпочитаю|мне нравится|мне не нравится|я не люблю|мой проект|моя цель|моя привычка|мой стиль|работаю над|важно для меня|зови меня|меня зовут)/i.test(
    text,
  );
}

function hasOpenLoopSignal(text: string): boolean {
  return /(?:напомни|вернемся|вернёмся|потом обсудим|позже обсудим|надо будет|планирую|хочу потом|не дай забыть|проверь позже)/i.test(
    text,
  );
}

function hasRecallSignal(text: string): boolean {
  return /(?:помнишь|что я|как я|у меня|мой|моя|мое|моё|мои|для меня|как обычно|как мы|мы обсуждали|в прошлый раз|раньше)/i.test(
    text,
  );
}

function looksLikeTechnicalStandalone(text: string): boolean {
  return /(?:typescript|react|rust|tauri|vite|api|ошибка|лог|баг|код|сборк|тест|файл|функц|компонент)/i.test(
    text,
  );
}

export function shouldRetrieveLongTermMemory(
  userMessage: string,
  input: { proactive?: boolean; ragEnabled?: boolean } = {},
): boolean {
  const text = userMessage.trim();
  if (!text) {
    return false;
  }
  if (input.proactive) {
    return true;
  }
  if (hasDurableMemorySignal(text) || hasOpenLoopSignal(text) || hasRecallSignal(text)) {
    return true;
  }
  if (isTinySocialMessage(text)) {
    return false;
  }
  if (looksLikeTechnicalStandalone(text) && !/проект|у меня|мой|моя|наше|наша/i.test(text)) {
    return false;
  }
  return text.length >= 90 || (input.ragEnabled === true && text.length >= 48);
}

export function shouldPostprocessConversationMemory(
  userMessage: string,
  assistantReply: string,
): boolean {
  const text = `${userMessage}\n${assistantReply}`.trim();
  if (!text || isTinySocialMessage(userMessage)) {
    return false;
  }
  if (hasDurableMemorySignal(userMessage) || hasOpenLoopSignal(userMessage)) {
    return true;
  }
  return /(?:решили|договорились|выбрали|зафиксировали|готово|получилось|следующий шаг|итог)/i.test(
    assistantReply,
  );
}

export function recordConversationMemoryExchange(input: {
  userMessage: string;
  assistantReply: string;
  emotion: CharacterEmotion;
  at?: number;
}): void {
  const user = compact(input.userMessage);
  if (!user || isTinySocialMessage(user)) {
    return;
  }
  const at = input.at ?? Date.now();
  if (hasDurableMemorySignal(user)) {
    pushEntry("preference", user, at);
    return;
  }
  if (hasOpenLoopSignal(user)) {
    pushEntry("open_thread", user, at);
    return;
  }
  if (
    input.emotion === "happy" ||
    input.emotion === "amused" ||
    input.emotion === "proud" ||
    input.emotion === "excited"
  ) {
    pushEntry("positive_signal", user, at);
    return;
  }
  if (input.emotion === "annoyed" || input.emotion === "worried" || input.emotion === "sad") {
    pushEntry("negative_signal", user, at);
    return;
  }
  if (user.length >= 32) {
    pushEntry("topic", user, at);
  }
}

export function describeConversationMemory(limit = 6, now = Date.now()): string {
  const entries = loadRaw(now).slice(-limit);
  if (!entries.length) {
    return "";
  }
  return entries
    .map((entry) => {
      const label = {
        topic: "recent topic",
        preference: "tone/user preference",
        positive_signal: "went well",
        negative_signal: "sensitive/friction",
        open_thread: "thread to revisit",
      }[entry.kind];
      return `- ${label}: ${entry.text}`;
    })
    .join("\n");
}

export function resetConversationMemoryForTests(): void {
  localStorage.removeItem(STORAGE_KEY);
}
