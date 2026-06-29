import { redactSecrets } from "../platform/secretRedaction";

export type ClipboardSignalKind = "code" | "stacktrace" | "url" | "text";

export type ActivitySignal =
  | {
      id: string;
      kind: "clipboard";
      clipKind: ClipboardSignalKind;
      snippet: string;
      at: number;
    }
  | {
      id: string;
      kind: "file_focus";
      process: string;
      title?: string;
      file?: string;
      repo?: string;
      branch?: string;
      dwellMs: number;
      at: number;
    }
  | {
      id: string;
      kind: "query_topic";
      topic: string;
      source: "chat" | "browser";
      at: number;
    }
  | {
      id: string;
      kind: "repeated_error";
      signature: string;
      count: number;
      at: number;
    };

export type ActivitySignalSummary = {
  recentSignals: ActivitySignal[];
  dominantFile?: string;
  dominantRepo?: string;
  dominantProcess?: string;
  repeatedErrorSignature?: string;
  repeatedErrorCount: number;
  topQueryThemes: string[];
  recentQueryTopics: string[];
  clipboardKinds: Partial<Record<ClipboardSignalKind, number>>;
  fileFocusCount: number;
  contextChurn: number;
  longestFileDwellMs: number;
  longestFile?: string;
};

const STORAGE_KEY = "desktop-character.activity-signals.v1";
const MAX_ENTRIES = 60;
const TTL_MS = 8 * 60 * 60 * 1000;
const RECENT_QUERY_WINDOW_MS = 2 * 60 * 60 * 1000;
const REPEATED_ERROR_THRESHOLD = 2;

let cache: ActivitySignal[] | null = null;

function loadRaw(): ActivitySignal[] {
  if (cache) {
    return cache;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      cache = [];
      return cache;
    }
    const parsed = JSON.parse(stored) as ActivitySignal[];
    cache = Array.isArray(parsed) ? parsed : [];
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

function saveRaw(entries: ActivitySignal[]): void {
  cache = entries.slice(-MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

export function invalidateActivitySignalsCache(): void {
  cache = null;
}

export function pruneActivitySignals(now = Date.now()): ActivitySignal[] {
  const entries = loadRaw();
  const pruned = entries.filter((entry) => now - entry.at < TTL_MS);
  if (pruned.length !== entries.length) {
    saveRaw(pruned);
  }
  return pruned;
}

function pushSignal(signal: ActivitySignal): void {
  const entries = pruneActivitySignals();
  entries.push(signal);
  saveRaw(entries);
}

function errorSignature(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        /(?:error|exception|traceback|panic|failed|ошибк|caused by)/i.test(
          line,
        ),
    );
  return redactSecrets(lines.slice(0, 3).join(" | ")).slice(0, 200);
}

function trackRepeatedError(signature: string, now = Date.now()): void {
  if (!signature.trim()) {
    return;
  }
  const entries = pruneActivitySignals(now);
  const existing = entries
    .filter(
      (entry): entry is Extract<ActivitySignal, { kind: "repeated_error" }> =>
        entry.kind === "repeated_error" && entry.signature === signature,
    )
    .sort((left, right) => right.at - left.at)[0];
  const count = (existing?.count ?? 1) + 1;
  if (count >= REPEATED_ERROR_THRESHOLD) {
    pushSignal({
      id: crypto.randomUUID(),
      kind: "repeated_error",
      signature,
      count,
      at: now,
    });
  }
}

export function recordClipboardSignal(input: {
  clipKind: ClipboardSignalKind;
  snippet: string;
  at?: number;
}): void {
  const snippet = redactSecrets(input.snippet.trim()).slice(0, 280);
  if (!snippet) {
    return;
  }
  const at = input.at ?? Date.now();
  pushSignal({
    id: crypto.randomUUID(),
    kind: "clipboard",
    clipKind: input.clipKind,
    snippet,
    at,
  });
  if (input.clipKind === "stacktrace") {
    trackRepeatedError(errorSignature(snippet), at);
  }
}

export function recordFileFocus(input: {
  process: string;
  title?: string;
  file?: string;
  repo?: string;
  branch?: string;
  dwellMs: number;
  at?: number;
}): void {
  const dwellMs = Math.max(0, Math.round(input.dwellMs));
  if (dwellMs < 30_000 || !input.process.trim()) {
    return;
  }
  pushSignal({
    id: crypto.randomUUID(),
    kind: "file_focus",
    process: input.process.slice(0, 120),
    title: input.title?.slice(0, 200),
    file: input.file?.slice(0, 160),
    repo: input.repo?.slice(0, 120),
    branch: input.branch?.slice(0, 80),
    dwellMs,
    at: input.at ?? Date.now(),
  });
}

export function recordQueryTopic(input: {
  topic: string;
  source: "chat" | "browser";
  at?: number;
}): void {
  const topic = redactSecrets(input.topic.trim()).slice(0, 160);
  if (!topic || topic.length < 4) {
    return;
  }
  const entries = pruneActivitySignals();
  const last = entries[entries.length - 1];
  if (
    last?.kind === "query_topic" &&
    last.topic === topic &&
    last.source === input.source &&
    Date.now() - last.at < 120_000
  ) {
    return;
  }
  pushSignal({
    id: crypto.randomUUID(),
    kind: "query_topic",
    topic,
    source: input.source,
    at: input.at ?? Date.now(),
  });
}

export function getActivitySignals(limit = MAX_ENTRIES): ActivitySignal[] {
  return pruneActivitySignals().slice(-limit);
}

export function summarizeActivitySignals(
  now = Date.now(),
  windowMs = TTL_MS,
): ActivitySignalSummary {
  const recentSignals = getActivitySignals().filter(
    (entry) => now - entry.at <= windowMs,
  );

  const fileDwell = new Map<string, number>();
  const repoCounts = new Map<string, number>();
  const processCounts = new Map<string, number>();
  const queryCounts = new Map<string, number>();
  const clipboardKinds: Partial<Record<ClipboardSignalKind, number>> = {};
  let repeatedErrorSignature: string | undefined;
  let repeatedErrorCount = 0;
  let longestFileDwellMs = 0;
  let longestFile: string | undefined;
  let contextChurn = 0;
  let lastFileKey: string | undefined;

  for (const entry of recentSignals) {
    switch (entry.kind) {
      case "clipboard":
        clipboardKinds[entry.clipKind] =
          (clipboardKinds[entry.clipKind] ?? 0) + 1;
        break;
      case "file_focus": {
        const key = entry.file ?? entry.title ?? entry.process;
        fileDwell.set(key, (fileDwell.get(key) ?? 0) + entry.dwellMs);
        if (entry.repo) {
          repoCounts.set(entry.repo, (repoCounts.get(entry.repo) ?? 0) + 1);
        }
        processCounts.set(
          entry.process,
          (processCounts.get(entry.process) ?? 0) + 1,
        );
        if (entry.dwellMs > longestFileDwellMs) {
          longestFileDwellMs = entry.dwellMs;
          longestFile = entry.file ?? entry.title;
        }
        if (lastFileKey && lastFileKey !== key) {
          contextChurn += 1;
        }
        lastFileKey = key;
        break;
      }
      case "query_topic":
        queryCounts.set(entry.topic, (queryCounts.get(entry.topic) ?? 0) + 1);
        break;
      case "repeated_error":
        if (!repeatedErrorSignature || entry.count >= repeatedErrorCount) {
          repeatedErrorSignature = entry.signature;
          repeatedErrorCount = entry.count;
        }
        break;
      default:
        break;
    }
  }

  const dominantFile = [...fileDwell.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  const dominantRepo = [...repoCounts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  const dominantProcess = [...processCounts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  const topQueryThemes = [...queryCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([topic]) => topic);

  const recentQueryTopics: string[] = [];
  const seenRecentQueries = new Set<string>();
  for (const entry of [...recentSignals].reverse()) {
    if (entry.kind !== "query_topic") {
      continue;
    }
    if (now - entry.at > RECENT_QUERY_WINDOW_MS) {
      continue;
    }
    const key = entry.topic.toLowerCase();
    if (seenRecentQueries.has(key)) {
      continue;
    }
    seenRecentQueries.add(key);
    recentQueryTopics.push(entry.topic);
    if (recentQueryTopics.length >= 5) {
      break;
    }
  }

  return {
    recentSignals,
    dominantFile,
    dominantRepo,
    dominantProcess,
    repeatedErrorSignature,
    repeatedErrorCount,
    topQueryThemes,
    recentQueryTopics,
    clipboardKinds,
    fileFocusCount: recentSignals.filter((entry) => entry.kind === "file_focus")
      .length,
    contextChurn,
    longestFileDwellMs,
    longestFile,
  };
}

export function formatActivitySignalsForDiagnostics(limit = 6): string[] {
  return getActivitySignals(limit).map((entry) => {
    switch (entry.kind) {
      case "clipboard":
        return `[clipboard:${entry.clipKind}] ${entry.snippet.slice(0, 80)}`;
      case "file_focus":
        return `[file] ${entry.file ?? entry.title ?? entry.process} (${Math.round(entry.dwellMs / 60_000)}m)`;
      case "query_topic":
        return `[query:${entry.source}] ${entry.topic}`;
      case "repeated_error":
        return `[error×${entry.count}] ${entry.signature.slice(0, 80)}`;
      default:
        return "";
    }
  }).filter(Boolean);
}
