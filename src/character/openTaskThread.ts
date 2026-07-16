import {
  findOpenTaskInHistory,
  looksLikeTaskOrProblemStatement,
  type ChatTurnLike,
} from "./taskShape";

export type OpenTaskThreadState = {
  excerpt: string;
  openedAt: number;
};

const STORAGE_KEY = "desktop-character.open-task-thread.v1";
const TTL_MS = 3 * 60 * 60 * 1000;
const EXCERPT_LIMIT = 900;

/** Explicit topic-change only — no guessing whether a message is a "step". */
const EXPLICIT_TASK_CLOSE =
  /(?:другая\s+тема|хватит\s+задач|давай\s+просто\s+поговор|просто\s+поболта|не\s+про\s+задач|без\s+задач|забудем\s+про\s+(?:это|задач)|закроем\s+задач|enough\s+(?:about\s+)?(?:the\s+)?(?:task|problem)|different\s+topic)/i;

function compactExcerpt(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, EXCERPT_LIMIT);
}

function loadState(now = Date.now()): OpenTaskThreadState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<OpenTaskThreadState>;
    if (
      typeof parsed.excerpt !== "string" ||
      !parsed.excerpt.trim() ||
      typeof parsed.openedAt !== "number"
    ) {
      return null;
    }
    if (now - parsed.openedAt > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { excerpt: parsed.excerpt, openedAt: parsed.openedAt };
  } catch {
    return null;
  }
}

function saveState(state: OpenTaskThreadState | null): void {
  if (!state) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function isExplicitTaskClose(message: string): boolean {
  return EXPLICIT_TASK_CLOSE.test(message.trim());
}

export function getOpenTaskThread(now = Date.now()): OpenTaskThreadState | null {
  return loadState(now);
}

export function isOpenTaskActive(now = Date.now()): boolean {
  return loadState(now) !== null;
}

export function openTaskThread(excerpt: string, openedAt = Date.now()): void {
  const compact = compactExcerpt(excerpt);
  if (!compact) {
    return;
  }
  saveState({ excerpt: compact, openedAt });
}

export function closeOpenTaskThread(): void {
  saveState(null);
}

export function resetOpenTaskThreadForTests(): void {
  saveState(null);
}

/**
 * Sync sticky state from the latest user message and optional chat history.
 * Call once per reply context build (before mode classification).
 */
export function syncOpenTaskThread(input: {
  lastUserMessage: string;
  history: ChatTurnLike[];
  now?: number;
}): OpenTaskThreadState | null {
  const now = input.now ?? Date.now();
  const message = input.lastUserMessage.trim();

  if (message && isExplicitTaskClose(message)) {
    closeOpenTaskThread();
    return null;
  }

  if (message && looksLikeTaskOrProblemStatement(message)) {
    openTaskThread(message, now);
    return loadState(now);
  }

  const existing = loadState(now);
  if (existing) {
    return existing;
  }

  // Migrate: recover excerpt from recent history when storage is empty.
  const fromHistory = findOpenTaskInHistory(input.history);
  if (fromHistory?.role === "user") {
    openTaskThread(fromHistory.content, now);
    return loadState(now);
  }

  return null;
}
