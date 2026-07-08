import type { ChatMessage } from "../types/chat";

export type AssistantMessageSource = "chat" | "proactive" | "ambient";

export type InteractionAcknowledgementEntry = {
  messageId: string;
  at: number;
  source: AssistantMessageSource;
  proactive: boolean;
  adviceId?: string;
  snippet: string;
};

export type AssistantIgnoredSignal = {
  kind: "assistant_ignored";
  messageId: string;
  source: AssistantMessageSource;
  proactive: boolean;
  adviceId?: string;
  ageMs: number;
  ignoredStreak: number;
  timestamp?: number;
};

export type InteractionAcknowledgementSummary = {
  pending: number;
  ignoredStreak: number;
  lastIgnoredAt?: number;
  lastRepairAt?: number;
  lastIgnoredSource?: AssistantMessageSource;
};

const STORAGE_KEY = "desktop-character.interaction-ack.v1";
const PENDING_TTL_MS = 6 * 60 * 60_000;
const DEFAULT_IGNORE_WINDOW_MS = 5 * 60_000;
const MAX_PENDING = 24;

type Store = {
  pending: InteractionAcknowledgementEntry[];
  ignoredStreak: number;
  lastIgnoredAt?: number;
  lastRepairAt?: number;
  lastIgnoredSource?: AssistantMessageSource;
};

const emptyStore: Store = {
  pending: [],
  ignoredStreak: 0,
};

function nowMs(): number {
  return Date.now();
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function isSource(value: unknown): value is AssistantMessageSource {
  return value === "chat" || value === "proactive" || value === "ambient";
}

function isEntry(value: unknown): value is InteractionAcknowledgementEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as InteractionAcknowledgementEntry;
  return (
    typeof candidate.messageId === "string" &&
    typeof candidate.at === "number" &&
    isSource(candidate.source) &&
    typeof candidate.proactive === "boolean" &&
    typeof candidate.snippet === "string"
  );
}

function loadStore(now = nowMs()): Store {
  if (!canUseStorage()) {
    return { ...emptyStore };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<Store>
      | null;
    if (!parsed) {
      return { ...emptyStore };
    }
    return {
      pending: Array.isArray(parsed.pending)
        ? parsed.pending
            .filter(isEntry)
            .filter((entry) => now - entry.at < PENDING_TTL_MS)
        : [],
      ignoredStreak:
        typeof parsed.ignoredStreak === "number"
          ? Math.max(0, Math.round(parsed.ignoredStreak))
          : 0,
      lastIgnoredAt:
        typeof parsed.lastIgnoredAt === "number" ? parsed.lastIgnoredAt : undefined,
      lastRepairAt:
        typeof parsed.lastRepairAt === "number" ? parsed.lastRepairAt : undefined,
      lastIgnoredSource: isSource(parsed.lastIgnoredSource)
        ? parsed.lastIgnoredSource
        : undefined,
    };
  } catch {
    return { ...emptyStore };
  }
}

function saveStore(store: Store): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...store,
      pending: store.pending.slice(-MAX_PENDING),
    }),
  );
}

export function inferAssistantMessageSource(
  message: ChatMessage,
): AssistantMessageSource {
  if (message.proactive || message.adviceId) {
    return "proactive";
  }
  return "chat";
}

export function trackAssistantMessageForAcknowledgement(input: {
  message: ChatMessage;
  source?: AssistantMessageSource;
  proactive?: boolean;
  now?: number;
}): InteractionAcknowledgementEntry | null {
  const { message } = input;
  if (
    message.role !== "assistant" ||
    !message.messageId ||
    !message.content.trim() ||
    message.isCanon === false
  ) {
    return null;
  }
  const now = input.now ?? nowMs();
  const source = input.source ?? inferAssistantMessageSource(message);
  const store = loadStore(now);
  if (store.pending.some((entry) => entry.messageId === message.messageId)) {
    return null;
  }
  const entry: InteractionAcknowledgementEntry = {
    messageId: message.messageId,
    at: now,
    source,
    proactive:
      input.proactive ??
      (source !== "chat" || Boolean(message.proactive) || Boolean(message.adviceId)),
    adviceId: message.adviceId,
    snippet: message.content.trim().slice(0, 180),
  };
  saveStore({
    ...store,
    pending: [...store.pending, entry].slice(-MAX_PENDING),
  });
  return entry;
}

export function acknowledgeAssistantMessage(
  messageId: string | undefined,
  now = nowMs(),
): boolean {
  if (!messageId) {
    return false;
  }
  const store = loadStore(now);
  const nextPending = store.pending.filter((entry) => entry.messageId !== messageId);
  if (nextPending.length === store.pending.length) {
    return false;
  }
  saveStore({
    ...store,
    pending: nextPending,
    ignoredStreak: Math.max(0, store.ignoredStreak - 1),
    lastRepairAt: now,
  });
  return true;
}

export function acknowledgeAllAssistantMessages(now = nowMs()): number {
  const store = loadStore(now);
  const count = store.pending.length;
  if (!count) {
    return 0;
  }
  saveStore({
    ...store,
    pending: [],
    ignoredStreak: 0,
    lastRepairAt: now,
  });
  return count;
}

export function recordInteractionRepair(now = nowMs()): void {
  const store = loadStore(now);
  saveStore({
    ...store,
    ignoredStreak: Math.max(0, store.ignoredStreak - 1),
    lastRepairAt: now,
  });
}

export function pruneIgnoredAssistantMessages(input?: {
  now?: number;
  ignoreWindowMs?: number;
}): AssistantIgnoredSignal[] {
  const now = input?.now ?? nowMs();
  const ignoreWindowMs = input?.ignoreWindowMs ?? DEFAULT_IGNORE_WINDOW_MS;
  const store = loadStore(now);
  const kept: InteractionAcknowledgementEntry[] = [];
  const ignored: AssistantIgnoredSignal[] = [];
  let streak = store.ignoredStreak;
  for (const entry of store.pending) {
    const ageMs = now - entry.at;
    if (ageMs < ignoreWindowMs) {
      kept.push(entry);
      continue;
    }
    streak += 1;
    ignored.push({
      kind: "assistant_ignored",
      messageId: entry.messageId,
      source: entry.source,
      proactive: entry.proactive,
      adviceId: entry.adviceId,
      ageMs,
      ignoredStreak: streak,
      timestamp: now,
    });
  }
  if (ignored.length || kept.length !== store.pending.length) {
    saveStore({
      ...store,
      pending: kept,
      ignoredStreak: streak,
      lastIgnoredAt: ignored.length ? now : store.lastIgnoredAt,
      lastIgnoredSource:
        ignored.length > 0
          ? ignored[ignored.length - 1]?.source
          : store.lastIgnoredSource,
    });
  }
  return ignored;
}

export function getInteractionAcknowledgementSummary(
  now = nowMs(),
): InteractionAcknowledgementSummary {
  const store = loadStore(now);
  return {
    pending: store.pending.length,
    ignoredStreak: store.ignoredStreak,
    lastIgnoredAt: store.lastIgnoredAt,
    lastRepairAt: store.lastRepairAt,
    lastIgnoredSource: store.lastIgnoredSource,
  };
}

export function resetInteractionAcknowledgementForTests(): void {
  if (canUseStorage()) {
    localStorage.removeItem(STORAGE_KEY);
  }
}
