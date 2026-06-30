import type { InitiativeKind } from "./initiativeKinds";
import type { ProactiveReplyTone } from "./proactiveTone";

export type AdviceFeedback =
  | "useful"
  | "not_now"
  | "miss"
  | "too_generic";

export type AdviceTopicState = {
  key: string;
  anchor?: string;
  processName?: string;
  windowTitle?: string;
  signalSummary?: string;
  refreshedAt: number;
  expiresAt: number;
};

export type AdviceLedgerEntry = {
  id: string;
  messageId?: string;
  at: number;
  updatedAt: number;
  expiresAt: number;
  topicKey: string;
  initiativeKind?: InitiativeKind;
  tone?: ProactiveReplyTone;
  anchor?: string;
  signalSummary?: string;
  linkNarrative?: string;
  practicalHook?: string;
  initiativeMove?: string;
  replyText?: string;
  feedback?: AdviceFeedback;
};

const LEDGER_KEY = "desktop-character.advice-ledger.v1";
const TOPIC_STATE_KEY = "desktop-character.advice-topic-state.v1";
const LEDGER_TTL_MS = 36 * 60 * 60_000;
const TOPIC_STATE_TTL_MS = 35 * 60_000;
const MAX_LEDGER_ENTRIES = 40;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeTopicPart(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 10)
    .join(" ")
    .trim();
}

export function buildAdviceTopicKey(input: {
  anchor?: string;
  signalSummary?: string;
  processName?: string;
  windowTitle?: string;
}): string {
  const coreParts = [
    normalizeTopicPart(input.anchor),
    normalizeTopicPart(input.processName),
    normalizeTopicPart(input.windowTitle),
  ].filter(Boolean);
  const parts = coreParts.length
    ? coreParts
    : [normalizeTopicPart(input.signalSummary).slice(0, 90)].filter(Boolean);
  return parts.join("::") || "ambient";
}

export function loadAdviceLedger(now = Date.now()): AdviceLedgerEntry[] {
  const entries = readJson<AdviceLedgerEntry[]>(LEDGER_KEY, []);
  const pruned = Array.isArray(entries)
    ? entries
        .filter((entry) => entry && now < entry.expiresAt)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_LEDGER_ENTRIES)
    : [];
  if (pruned.length !== entries.length) {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(pruned));
  }
  return pruned;
}

function saveAdviceLedger(entries: AdviceLedgerEntry[]): void {
  localStorage.setItem(
    LEDGER_KEY,
    JSON.stringify(
      entries
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_LEDGER_ENTRIES),
    ),
  );
}

export function refreshAdviceTopicState(
  input: Omit<AdviceTopicState, "key" | "refreshedAt" | "expiresAt">,
  now = Date.now(),
): AdviceTopicState {
  const key = buildAdviceTopicKey(input);
  const state: AdviceTopicState = {
    key,
    anchor: input.anchor,
    processName: input.processName,
    windowTitle: input.windowTitle,
    signalSummary: input.signalSummary,
    refreshedAt: now,
    expiresAt: now + TOPIC_STATE_TTL_MS,
  };
  localStorage.setItem(TOPIC_STATE_KEY, JSON.stringify(state));
  return state;
}

export function loadAdviceTopicState(
  now = Date.now(),
): AdviceTopicState | null {
  const state = readJson<AdviceTopicState | null>(TOPIC_STATE_KEY, null);
  if (!state || now >= state.expiresAt) {
    localStorage.removeItem(TOPIC_STATE_KEY);
    return null;
  }
  return state;
}

export function clearAdviceTopicState(): void {
  localStorage.removeItem(TOPIC_STATE_KEY);
}

export function rememberAdviceSent(
  input: Omit<AdviceLedgerEntry, "id" | "at" | "updatedAt" | "expiresAt" | "topicKey"> & {
    topicKey?: string;
    processName?: string;
    windowTitle?: string;
  },
  now = Date.now(),
): AdviceLedgerEntry {
  const topicKey =
    input.topicKey ??
    buildAdviceTopicKey({
      anchor: input.anchor,
      signalSummary: input.signalSummary,
      processName: input.processName,
      windowTitle: input.windowTitle,
    });
  const entry: AdviceLedgerEntry = {
    id: crypto.randomUUID(),
    messageId: input.messageId,
    at: now,
    updatedAt: now,
    expiresAt: now + LEDGER_TTL_MS,
    topicKey,
    initiativeKind: input.initiativeKind,
    tone: input.tone,
    anchor: input.anchor,
    signalSummary: input.signalSummary,
    linkNarrative: input.linkNarrative,
    practicalHook: input.practicalHook,
    initiativeMove: input.initiativeMove,
    replyText: input.replyText?.slice(0, 700),
  };
  saveAdviceLedger([entry, ...loadAdviceLedger(now)]);
  return entry;
}

export function updateAdviceFeedback(
  adviceId: string,
  feedback: AdviceFeedback,
  now = Date.now(),
): AdviceLedgerEntry | null {
  const entries = loadAdviceLedger(now);
  let updated: AdviceLedgerEntry | null = null;
  const next = entries.map((entry) => {
    if (entry.id !== adviceId) return entry;
    updated = { ...entry, feedback, updatedAt: now };
    return updated;
  });
  if (updated) {
    saveAdviceLedger(next);
  }
  return updated;
}

export function getRecentAdviceFeedback(
  topicKey?: string,
  now = Date.now(),
): AdviceLedgerEntry[] {
  return loadAdviceLedger(now).filter((entry) =>
    topicKey ? entry.topicKey === topicKey : true,
  );
}

export function describeAdviceMemoryForPrompt(
  topicKey?: string,
  now = Date.now(),
): string {
  const entries = getRecentAdviceFeedback(topicKey, now)
    .filter((entry) => entry.feedback)
    .slice(0, 4);
  if (!entries.length) {
    return "";
  }
  const labels: Record<AdviceFeedback, string> = {
    useful: "полезно",
    not_now: "не сейчас",
    miss: "мимо контекста",
    too_generic: "слишком общо",
  };
  const lines = entries.map((entry) => {
    const anchor = entry.anchor ? ` (${entry.anchor.slice(0, 80)})` : "";
    return `- ${labels[entry.feedback!]}${anchor}`;
  });
  return [
    "Недавняя обратная связь на советы по этой теме:",
    ...lines,
    "Если было «мимо» или «слишком общо», смени ход: меньше общих фраз, один проверяемый шаг, привязанный к свежему факту.",
    "Если было «не сейчас», снизь напор и не повторяй тот же совет.",
  ].join("\n");
}

export function resetAdviceLedgerForTests(): void {
  localStorage.removeItem(LEDGER_KEY);
  localStorage.removeItem(TOPIC_STATE_KEY);
}
