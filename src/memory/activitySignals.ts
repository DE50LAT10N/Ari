import { redactAndTruncate, redactSecrets } from "../platform/secretRedaction";
import { isClipboardSemanticallyRich } from "../platform/clipboardSemantics";

export type ClipboardSignalKind =
  | "code"
  | "stacktrace"
  | "diagnostic"
  | "url"
  | "text";

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
    }
  | {
      id: string;
      kind: "input_friction";
      frictionKind:
        | "long_pause"
        | "rapid_return"
        | "active_dwell"
        | "keyboard_burst"
        | "correction_churn"
        | "command_loop";
      process: string;
      title?: string;
      file?: string;
      idleSeconds?: number;
      dwellMs?: number;
      keyCount?: number;
      correctionCount?: number;
      commandCount?: number;
      burstCount?: number;
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
  latestClipboard?: Extract<ActivitySignal, { kind: "clipboard" }>;
  substantiveClipboardCount: number;
  fileFocusCount: number;
  contextChurn: number;
  longestFileDwellMs: number;
  longestFile?: string;
  inputFrictionScore: number;
  recentInputPauses: number;
  recentInputReturns: number;
  recentKeyboardBursts: number;
  recentCorrectionChurns: number;
  recentCommandLoops: number;
  lastInputFriction?: Extract<ActivitySignal, { kind: "input_friction" }>;
};

const STORAGE_KEY = "desktop-character.activity-signals.v1";
const MAX_ENTRIES = 60;
const TTL_MS = 8 * 60 * 60 * 1000;
const RECENT_QUERY_WINDOW_MS = 2 * 60 * 60 * 1000;
const INPUT_FRICTION_WINDOW_MS = 35 * 60 * 1000;
const REPEATED_ERROR_THRESHOLD = 2;

let cache: ActivitySignal[] | null = null;

function sanitizeActivityText(value: string | undefined, maxLength: number): string | undefined {
  const sanitized = redactSecrets(value?.trim() ?? "").slice(0, maxLength);
  return sanitized || undefined;
}

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
  return redactAndTruncate(lines.slice(0, 3).join(" | "), 200);
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
  const snippet = redactAndTruncate(input.snippet.trim(), 2_000);
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
  const process = sanitizeActivityText(input.process, 120);
  if (dwellMs < 30_000 || !process) {
    return;
  }
  pushSignal({
    id: crypto.randomUUID(),
    kind: "file_focus",
    process,
    title: sanitizeActivityText(input.title, 200),
    file: sanitizeActivityText(input.file, 160),
    repo: sanitizeActivityText(input.repo, 120),
    branch: sanitizeActivityText(input.branch, 80),
    dwellMs,
    at: input.at ?? Date.now(),
  });
}

export function recordQueryTopic(input: {
  topic: string;
  source: "chat" | "browser";
  at?: number;
}): void {
  const topic = redactAndTruncate(input.topic.trim(), 160);
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

export function recordInputFriction(input: {
  frictionKind:
    | "long_pause"
    | "rapid_return"
    | "active_dwell"
    | "keyboard_burst"
    | "correction_churn"
    | "command_loop";
  process: string;
  title?: string;
  file?: string;
  idleSeconds?: number;
  dwellMs?: number;
  keyCount?: number;
  correctionCount?: number;
  commandCount?: number;
  burstCount?: number;
  at?: number;
}): void {
  const process = sanitizeActivityText(input.process, 120);
  if (!process) {
    return;
  }
  const at = input.at ?? Date.now();
  const title = sanitizeActivityText(input.title, 200);
  const file = sanitizeActivityText(input.file, 160);
  const entries = pruneActivitySignals(at);
  const last = [...entries]
    .reverse()
    .find(
      (entry): entry is Extract<ActivitySignal, { kind: "input_friction" }> =>
        entry.kind === "input_friction" &&
        entry.frictionKind === input.frictionKind &&
        entry.process === process &&
        (entry.file ?? entry.title) === (file ?? title),
    );
  if (last && at - last.at < 3 * 60_000) {
    return;
  }
  pushSignal({
    id: crypto.randomUUID(),
    kind: "input_friction",
    frictionKind: input.frictionKind,
    process,
    title,
    file,
    idleSeconds:
      input.idleSeconds !== undefined
        ? Math.max(0, Math.round(input.idleSeconds))
        : undefined,
    dwellMs:
      input.dwellMs !== undefined
        ? Math.max(0, Math.round(input.dwellMs))
        : undefined,
    keyCount:
      input.keyCount !== undefined
        ? Math.max(0, Math.round(input.keyCount))
        : undefined,
    correctionCount:
      input.correctionCount !== undefined
        ? Math.max(0, Math.round(input.correctionCount))
        : undefined,
    commandCount:
      input.commandCount !== undefined
        ? Math.max(0, Math.round(input.commandCount))
        : undefined,
    burstCount:
      input.burstCount !== undefined
        ? Math.max(0, Math.round(input.burstCount))
        : undefined,
    at,
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
  let latestClipboard: Extract<ActivitySignal, { kind: "clipboard" }> | undefined;
  let substantiveClipboardCount = 0;
  let repeatedErrorSignature: string | undefined;
  let repeatedErrorCount = 0;
  let longestFileDwellMs = 0;
  let longestFile: string | undefined;
  let contextChurn = 0;
  let lastFileKey: string | undefined;
  let inputFrictionScore = 0;
  let recentInputPauses = 0;
  let recentInputReturns = 0;
  let recentKeyboardBursts = 0;
  let recentCorrectionChurns = 0;
  let recentCommandLoops = 0;
  let lastInputFriction:
    | Extract<ActivitySignal, { kind: "input_friction" }>
    | undefined;

  for (const entry of recentSignals) {
    switch (entry.kind) {
      case "clipboard":
        clipboardKinds[entry.clipKind] =
          (clipboardKinds[entry.clipKind] ?? 0) + 1;
        latestClipboard = entry;
        if (
          ["code", "stacktrace", "diagnostic", "url"].includes(entry.clipKind) ||
          isClipboardSemanticallyRich(entry.snippet)
        ) {
          substantiveClipboardCount += 1;
        }
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
      case "input_friction":
        if (now - entry.at <= INPUT_FRICTION_WINDOW_MS) {
          lastInputFriction = entry;
          if (entry.frictionKind === "long_pause") {
            recentInputPauses += 1;
            inputFrictionScore += 1.2;
          } else if (entry.frictionKind === "rapid_return") {
            recentInputReturns += 1;
            inputFrictionScore += 1;
          } else if (entry.frictionKind === "keyboard_burst") {
            recentKeyboardBursts += 1;
            inputFrictionScore += 1.1;
          } else if (entry.frictionKind === "correction_churn") {
            recentCorrectionChurns += 1;
            inputFrictionScore += 1.5;
          } else if (entry.frictionKind === "command_loop") {
            recentCommandLoops += 1;
            inputFrictionScore += 1.2;
          } else {
            inputFrictionScore += 0.6;
          }
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
    latestClipboard,
    substantiveClipboardCount,
    fileFocusCount: recentSignals.filter((entry) => entry.kind === "file_focus")
      .length,
    contextChurn,
    longestFileDwellMs,
    longestFile,
    inputFrictionScore: Math.min(5, Number(inputFrictionScore.toFixed(2))),
    recentInputPauses,
    recentInputReturns,
    recentKeyboardBursts,
    recentCorrectionChurns,
    recentCommandLoops,
    lastInputFriction,
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
      case "input_friction":
        return `[input:${entry.frictionKind}] ${entry.file ?? entry.title ?? entry.process}`;
      case "repeated_error":
        return `[error×${entry.count}] ${entry.signature.slice(0, 80)}`;
      default:
        return "";
    }
  }).filter(Boolean);
}
