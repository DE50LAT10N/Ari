import { getDailyInitiativeCount } from "../character/initiativeScoring";

const AUTO_COMMIT_KEY = "desktop-character.memory-auto-commit.v1";
const INBOX_KEY = "desktop-character.memory-inbox-candidates.v1";
const TRIM_KEY = "desktop-character.context-trim.v1";
const SUPPRESS_KEY = "desktop-character.initiative-suppress.v1";

type AutoCommitEntry = {
  text: string;
  importance: string;
  confidence: number;
  at: number;
};

type SuppressEntry = {
  reason: string;
  at: number;
};

function readList<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, values: T[], max: number): void {
  localStorage.setItem(key, JSON.stringify(values.slice(-max)));
}

export function recordMemoryAutoCommit(
  text: string,
  importance: string,
  confidence: number,
): void {
  const next = readList<AutoCommitEntry>(AUTO_COMMIT_KEY);
  next.push({
    text: text.slice(0, 160),
    importance,
    confidence,
    at: Date.now(),
  });
  writeList(AUTO_COMMIT_KEY, next, 20);
}

export function recordMemoryInboxCandidate(text: string): void {
  const next = readList<{ text: string; at: number }>(INBOX_KEY);
  next.push({ text: text.slice(0, 160), at: Date.now() });
  writeList(INBOX_KEY, next, 20);
}

export function recordContextTrim(note: string): void {
  const next = readList<{ note: string; at: number }>(TRIM_KEY);
  next.push({ note, at: Date.now() });
  writeList(TRIM_KEY, next, 12);
}

export function recordInitiativeSuppressed(reason: string): void {
  const next = readList<SuppressEntry>(SUPPRESS_KEY);
  next.push({ reason: reason.slice(0, 180), at: Date.now() });
  writeList(SUPPRESS_KEY, next, 24);
}

export type MemoryHealthSnapshot = {
  autoCommitsToday: number;
  lastAutoCommits: AutoCommitEntry[];
  lastInboxCandidates: Array<{ text: string; at: number }>;
  lastContextTrims: Array<{ note: string; at: number }>;
  initiativesToday: number;
  lastSuppressions: SuppressEntry[];
};

export function getMemoryHealthSnapshot(): MemoryHealthSnapshot {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const autoCommits = readList<AutoCommitEntry>(AUTO_COMMIT_KEY);
  return {
    autoCommitsToday: autoCommits.filter((entry) => entry.at >= todayMs).length,
    lastAutoCommits: autoCommits.slice(-5),
    lastInboxCandidates: readList<{ text: string; at: number }>(INBOX_KEY).slice(-5),
    lastContextTrims: readList<{ note: string; at: number }>(TRIM_KEY).slice(-4),
    initiativesToday: getDailyInitiativeCount(),
    lastSuppressions: readList<SuppressEntry>(SUPPRESS_KEY).slice(-5),
  };
}
