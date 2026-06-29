const LAST_TYPING_KEY = "desktop-character.last-chat-typing.v1";
const LAST_COMPANION_KEY = "desktop-character.last-companion-interaction.v1";
const PERSIST_INTERVAL_MS = 5000;

let lastChatTypingAt = (() => {
  try {
    const stored = Number(localStorage.getItem(LAST_TYPING_KEY) ?? 0);
    return stored > 0 ? stored : Date.now();
  } catch {
    return Date.now();
  }
})();
let lastCompanionInteractionAt = (() => {
  try {
    const stored = Number(localStorage.getItem(LAST_COMPANION_KEY) ?? 0);
    if (stored > 0) {
      return stored;
    }
  } catch {
    // ignore
  }
  return lastChatTypingAt;
})();
let chatInputFocused = false;
let lastPersistAt = 0;

/** Без печати в поле ввода столько секунд — считаем пользователя «ушедшим». */
export const CHAT_TYPING_IDLE_SECONDS = 90;

function persistTypingTimestamp(force = false): void {
  const now = Date.now();
  if (!force && now - lastPersistAt < PERSIST_INTERVAL_MS) {
    return;
  }
  lastPersistAt = now;
  try {
    localStorage.setItem(LAST_TYPING_KEY, String(lastChatTypingAt));
  } catch {
    // ignore
  }
}

export function recordChatTyping(): void {
  lastChatTypingAt = Date.now();
  recordCompanionInteraction();
  persistTypingTimestamp();
}

export function recordCompanionInteraction(): void {
  lastCompanionInteractionAt = Date.now();
  try {
    localStorage.setItem(LAST_COMPANION_KEY, String(lastCompanionInteractionAt));
  } catch {
    // ignore
  }
}

export function getCompanionSilenceMs(now = Date.now()): number {
  return Math.max(0, now - lastCompanionInteractionAt);
}

export function flushChatTypingPersist(): void {
  persistTypingTimestamp(true);
}

export function setChatInputFocused(focused: boolean): void {
  chatInputFocused = focused;
  if (focused) {
    lastChatTypingAt = Date.now();
  }
  persistTypingTimestamp(true);
}

export function isChatInputFocused(): boolean {
  return chatInputFocused;
}

export function getTypingIdleSeconds(): number {
  if (!chatInputFocused) return 0;
  return Math.max(0, Math.floor((Date.now() - lastChatTypingAt) / 1000));
}

/**
 * Комбинирует системный idle Windows с локальным «нет печати в чате».
 * Если чат открыт и курсор в поле ввода, но пользователь не печатает —
 * через CHAT_TYPING_IDLE_SECONDS Ari считает его ушедшим.
 */
export function getEffectiveIdleSeconds(
  systemIdleSeconds: number,
  chatOpen: boolean,
): number {
  if (!chatOpen) {
    return systemIdleSeconds;
  }

  if (chatInputFocused) {
    const typingIdle = getTypingIdleSeconds();
    return Math.max(systemIdleSeconds, typingIdle);
  }

  // Чат открыт, но фокус не в поле — мягче: только системный idle.
  return systemIdleSeconds;
}
