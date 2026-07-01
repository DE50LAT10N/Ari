const LAST_PROACTIVE_MESSAGE_KEY =
  "desktop-character.last-proactive-message.v1";
const LAST_PROACTIVE_ATTEMPT_KEY =
  "desktop-character.last-proactive-attempt.v1";
const LAST_ADVICE_ATTEMPT_KEY =
  "ari.lastProactiveAdviceAttemptAt";
const LAST_SMALLTALK_ATTEMPT_KEY =
  "ari.lastProactiveSmalltalkAttemptAt";
const RECENT_PROACTIVE_TOPICS_KEY =
  "desktop-character.recent-proactive-topics.v1";
const PROACTIVE_SUBJECT_COOLDOWN_KEY =
  "desktop-character.proactive-subject-cooldown.v1";
const LAST_ADVICE_SUBJECT_KEY =
  "desktop-character.last-advice-subject.v1";
const PROACTIVE_FAILURE_BACKOFF_KEY =
  "desktop-character.proactive-failure-backoff.v1";

export const PROACTIVE_SUBJECT_COOLDOWN_MS = 3 * 60 * 60 * 1000;

const PROACTIVE_FAILURE_BACKOFF_STEPS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
];

let topicsCache: string[] | null = null;
let lastMessageCache: number | null = null;
let lastAttemptCache: number | null = null;
let lastAdviceAttemptCache: number | null = null;
let lastSmalltalkAttemptCache: number | null = null;

type SubjectCooldownEntry = { subject: string; at: number };
export type ProactiveFailureBackoff = {
  failures: number;
  until: number;
  at: number;
  reason?: string;
};

export function invalidateProactiveStateCache(): void {
  topicsCache = null;
  lastMessageCache = null;
  lastAttemptCache = null;
  lastAdviceAttemptCache = null;
  lastSmalltalkAttemptCache = null;
}

export function resetProactiveStateForTests(): void {
  topicsCache = null;
  lastMessageCache = null;
  lastAttemptCache = null;
  lastAdviceAttemptCache = null;
  lastSmalltalkAttemptCache = null;
  localStorage.removeItem(RECENT_PROACTIVE_TOPICS_KEY);
  localStorage.removeItem(PROACTIVE_SUBJECT_COOLDOWN_KEY);
  localStorage.removeItem(LAST_ADVICE_SUBJECT_KEY);
  localStorage.removeItem(LAST_PROACTIVE_MESSAGE_KEY);
  localStorage.removeItem(LAST_PROACTIVE_ATTEMPT_KEY);
  localStorage.removeItem(LAST_ADVICE_ATTEMPT_KEY);
  localStorage.removeItem(LAST_SMALLTALK_ATTEMPT_KEY);
  localStorage.removeItem(PROACTIVE_FAILURE_BACKOFF_KEY);
  localStorage.removeItem("desktop-character.idle-lines-recent.v1");
}

function loadProactiveFailureBackoff(): ProactiveFailureBackoff | null {
  try {
    const stored = JSON.parse(
      localStorage.getItem(PROACTIVE_FAILURE_BACKOFF_KEY) ?? "null",
    ) as unknown;
    if (
      !stored ||
      typeof stored !== "object" ||
      typeof (stored as ProactiveFailureBackoff).failures !== "number" ||
      typeof (stored as ProactiveFailureBackoff).until !== "number" ||
      typeof (stored as ProactiveFailureBackoff).at !== "number"
    ) {
      return null;
    }
    return stored as ProactiveFailureBackoff;
  } catch {
    return null;
  }
}

export function getProactiveFailureBackoff(
  now = Date.now(),
): ProactiveFailureBackoff | null {
  const backoff = loadProactiveFailureBackoff();
  if (!backoff) {
    return null;
  }
  if (backoff.until <= now) {
    localStorage.removeItem(PROACTIVE_FAILURE_BACKOFF_KEY);
    return null;
  }
  return backoff;
}

export function registerProactiveFailure(
  reason: string,
  now = Date.now(),
): ProactiveFailureBackoff {
  const previous = loadProactiveFailureBackoff();
  const failures =
    previous && now - previous.at < 2 * 60 * 60 * 1000
      ? Math.min(previous.failures + 1, PROACTIVE_FAILURE_BACKOFF_STEPS_MS.length)
      : 1;
  const duration =
    PROACTIVE_FAILURE_BACKOFF_STEPS_MS[
      Math.min(failures - 1, PROACTIVE_FAILURE_BACKOFF_STEPS_MS.length - 1)
    ];
  const backoff: ProactiveFailureBackoff = {
    failures,
    until: now + duration,
    at: now,
    reason: reason.trim().slice(0, 160) || "proactive generation failed",
  };
  localStorage.setItem(PROACTIVE_FAILURE_BACKOFF_KEY, JSON.stringify(backoff));
  window.dispatchEvent(new Event("ari-proactive-state-changed"));
  return backoff;
}

export function clearProactiveFailureBackoff(): void {
  if (localStorage.getItem(PROACTIVE_FAILURE_BACKOFF_KEY) === null) {
    return;
  }
  localStorage.removeItem(PROACTIVE_FAILURE_BACKOFF_KEY);
  window.dispatchEvent(new Event("ari-proactive-state-changed"));
}

export function normalizeProactiveSubject(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*[—–-]\s*.*/u, "")
    .replace(/[^\p{L}\p{N}\s._]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 8)
    .join(" ")
    .trim();
}

function loadSubjectCooldowns(
  now = Date.now(),
  maxAgeMs = PROACTIVE_SUBJECT_COOLDOWN_MS,
): SubjectCooldownEntry[] {
  try {
    const stored = JSON.parse(
      localStorage.getItem(PROACTIVE_SUBJECT_COOLDOWN_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored
      .filter(
        (entry): entry is SubjectCooldownEntry =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as SubjectCooldownEntry).subject === "string" &&
          typeof (entry as SubjectCooldownEntry).at === "number",
      )
      .filter((entry) => now - entry.at < maxAgeMs);
  } catch {
    return [];
  }
}

export function getProactiveCooldownSubjects(
  now = Date.now(),
): string[] {
  return loadSubjectCooldowns(now).map((entry) => entry.subject);
}

export function isProactiveSubjectOnCooldown(
  subject: string,
  cooldownMs = PROACTIVE_SUBJECT_COOLDOWN_MS,
  now = Date.now(),
): boolean {
  const key = normalizeProactiveSubject(subject);
  if (!key) {
    return false;
  }
  const words = key.split(/\s+/).filter((word) => word.length > 3);
  return loadSubjectCooldowns(now, cooldownMs).some((entry) => {
    if (entry.subject === key) {
      return true;
    }
    const cooledWords = entry.subject
      .split(/\s+/)
      .filter((word) => word.length > 3);
    const overlap = words.filter((word) => cooledWords.includes(word)).length;
    return overlap >= 2 || (overlap >= 1 && words.length === 1 && words[0].length >= 8);
  });
}

export function rememberProactiveSubject(
  subject: string,
  at = Date.now(),
): void {
  const key = normalizeProactiveSubject(subject);
  if (!key) {
    return;
  }
  const entries = [
    { subject: key, at },
    ...loadSubjectCooldowns(at).filter((entry) => entry.subject !== key),
  ].slice(0, 24);
  localStorage.setItem(
    PROACTIVE_SUBJECT_COOLDOWN_KEY,
    JSON.stringify(entries),
  );
}

type AdviceSubjectState = { subject: string; at: number };

export function rememberAdviceSubject(subject: string, at = Date.now()): void {
  const key = normalizeProactiveSubject(subject);
  if (!key) {
    return;
  }
  localStorage.setItem(
    LAST_ADVICE_SUBJECT_KEY,
    JSON.stringify({ subject: key, at }),
  );
  rememberProactiveSubject(subject, at);
}

export function isAdviceSubjectRecentlyAdvised(
  subject: string,
  minGapMs: number,
  now = Date.now(),
): boolean {
  const key = normalizeProactiveSubject(subject);
  if (!key) {
    return false;
  }
  if (isProactiveSubjectOnCooldown(subject, minGapMs, now)) {
    return true;
  }
  try {
    const stored = JSON.parse(
      localStorage.getItem(LAST_ADVICE_SUBJECT_KEY) ?? "null",
    ) as AdviceSubjectState | null;
    if (!stored || stored.subject !== key) {
      return false;
    }
    return now - stored.at < minGapMs;
  } catch {
    return false;
  }
}

export function getLastProactiveMessageAt(): number {
  if (lastMessageCache !== null) {
    return lastMessageCache;
  }
  lastMessageCache = Number(localStorage.getItem(LAST_PROACTIVE_MESSAGE_KEY) ?? 0);
  return lastMessageCache;
}

export function setLastProactiveMessageAt(timestamp = Date.now()): void {
  lastMessageCache = timestamp;
  localStorage.setItem(LAST_PROACTIVE_MESSAGE_KEY, String(timestamp));
  window.dispatchEvent(new Event("ari-proactive-state-changed"));
}

export function getLastAdviceAttemptAt(): number {
  if (lastAdviceAttemptCache !== null) {
    return lastAdviceAttemptCache;
  }
  const stored = localStorage.getItem(LAST_ADVICE_ATTEMPT_KEY);
  lastAdviceAttemptCache =
    stored !== null ? Number(stored) : Number(localStorage.getItem(LAST_PROACTIVE_ATTEMPT_KEY) ?? 0);
  return lastAdviceAttemptCache;
}

export function getLastSmalltalkAttemptAt(): number {
  if (lastSmalltalkAttemptCache !== null) {
    return lastSmalltalkAttemptCache;
  }
  const stored = localStorage.getItem(LAST_SMALLTALK_ATTEMPT_KEY);
  lastSmalltalkAttemptCache =
    stored !== null ? Number(stored) : Number(localStorage.getItem(LAST_PROACTIVE_ATTEMPT_KEY) ?? 0);
  return lastSmalltalkAttemptCache;
}

export function markAdviceAttemptAt(timestamp = Date.now()): void {
  lastAdviceAttemptCache = timestamp;
  lastAttemptCache = Math.max(timestamp, getLastSmalltalkAttemptAt());
  localStorage.setItem(LAST_ADVICE_ATTEMPT_KEY, String(timestamp));
  localStorage.setItem(LAST_PROACTIVE_ATTEMPT_KEY, String(lastAttemptCache));
  window.dispatchEvent(new Event("ari-proactive-state-changed"));
}

export function markSmalltalkAttemptAt(timestamp = Date.now()): void {
  lastSmalltalkAttemptCache = timestamp;
  lastAttemptCache = Math.max(timestamp, getLastAdviceAttemptAt());
  localStorage.setItem(LAST_SMALLTALK_ATTEMPT_KEY, String(timestamp));
  localStorage.setItem(LAST_PROACTIVE_ATTEMPT_KEY, String(lastAttemptCache));
  window.dispatchEvent(new Event("ari-proactive-state-changed"));
}

export function armProactiveGracePeriod(
  adviceIntervalMs: number,
  smalltalkIntervalMs = adviceIntervalMs,
): void {
  const now = Date.now();
  const adviceGraceAt = now - Math.max(adviceIntervalMs, 15_000);
  const smalltalkGraceAt = now - Math.max(smalltalkIntervalMs, 15_000);
  markAdviceAttemptAt(adviceGraceAt);
  markSmalltalkAttemptAt(smalltalkGraceAt);
  if (!getLastProactiveMessageAt()) {
    setLastProactiveMessageAt(Math.max(adviceGraceAt, smalltalkGraceAt));
  }
}

export function ensureProactiveClockStarted(
  adviceIntervalMs = 20 * 60_000,
  smalltalkIntervalMs = adviceIntervalMs,
): void {
  if (localStorage.getItem(LAST_PROACTIVE_MESSAGE_KEY) === null) {
    setLastProactiveMessageAt(Date.now() - Math.min(adviceIntervalMs, smalltalkIntervalMs));
  }
  if (localStorage.getItem(LAST_ADVICE_ATTEMPT_KEY) === null) {
    markAdviceAttemptAt(Date.now() - adviceIntervalMs);
  }
  if (localStorage.getItem(LAST_SMALLTALK_ATTEMPT_KEY) === null) {
    markSmalltalkAttemptAt(Date.now() - smalltalkIntervalMs);
  }
  if (localStorage.getItem(LAST_PROACTIVE_ATTEMPT_KEY) === null) {
    localStorage.setItem(
      LAST_PROACTIVE_ATTEMPT_KEY,
      String(Math.max(getLastAdviceAttemptAt(), getLastSmalltalkAttemptAt())),
    );
  }
}

export function getRecentProactiveTopics(): string[] {
  if (topicsCache) {
    return [...topicsCache];
  }
  try {
    const stored = JSON.parse(
      localStorage.getItem(RECENT_PROACTIVE_TOPICS_KEY) ?? "[]",
    ) as unknown;
    topicsCache = Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === "string")
      : [];
    return [...topicsCache];
  } catch {
    topicsCache = [];
    return [];
  }
}

export function rememberProactiveTopic(topic: string): void {
  const normalized = topic.trim();
  if (!normalized) {
    return;
  }

  const topics = [
    normalized,
    ...getRecentProactiveTopics().filter(
      (value) => value.toLowerCase() !== normalized.toLowerCase(),
    ),
  ].slice(0, 8);
  topicsCache = topics;
  localStorage.setItem(RECENT_PROACTIVE_TOPICS_KEY, JSON.stringify(topics));
  rememberProactiveSubject(normalized);
}

export function registerProactiveReplySubject(
  anchor: string | undefined,
  replyText: string,
): void {
  const anchorTrimmed = anchor?.trim();
  if (anchorTrimmed) {
    rememberProactiveTopic(anchorTrimmed);
    return;
  }
  const snippet = replyText
    .replace(/<emotion>[^<]+<\/emotion>/gi, "")
    .trim()
    .slice(0, 160);
  if (snippet.length >= 12) {
    rememberProactiveTopic(snippet);
  }
}
