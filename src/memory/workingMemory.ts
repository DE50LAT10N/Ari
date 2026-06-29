export type WorkingMemoryKind =
  | "window_switch"
  | "focus_update"
  | "screen_glance"
  | "process_note"
  | "chat_question"
  | "user_action"
  | "distraction";

const kindLabels: Partial<Record<WorkingMemoryKind, string>> = {
  chat_question: "вопрос",
  user_action: "действие",
  distraction: "отвлечение",
};

export type WorkingMemoryEntry = {
  id: string;
  kind: WorkingMemoryKind;
  app?: string;
  title?: string;
  topic: string;
  at: number;
};

export type WorkingMemorySummary = {
  distinctApps: string[];
  windowSwitchCount: number;
  rapidContextSwitches: number;
  distractionApps: Array<{ app: string; count: number }>;
  topDistraction?: { app: string; count: number };
};

const STORAGE_KEY = "desktop-character.working-memory.v1";
const TTL_MS = 7 * 60 * 60 * 1000;
const MAX_ENTRIES = 40;

let workingMemoryCache: WorkingMemoryEntry[] | null = null;

export function invalidateWorkingMemoryCache(): void {
  workingMemoryCache = null;
}

function loadRaw(): WorkingMemoryEntry[] {
  if (workingMemoryCache) {
    return workingMemoryCache;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      workingMemoryCache = [];
      return workingMemoryCache;
    }
    const parsed = JSON.parse(stored) as WorkingMemoryEntry[];
    workingMemoryCache = Array.isArray(parsed) ? parsed : [];
    return workingMemoryCache;
  } catch {
    workingMemoryCache = [];
    return workingMemoryCache;
  }
}

function saveRaw(entries: WorkingMemoryEntry[]): void {
  workingMemoryCache = entries.slice(-MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workingMemoryCache));
}

export function pruneWorkingMemory(now = Date.now()): WorkingMemoryEntry[] {
  const entries = loadRaw();
  const pruned = entries.filter((entry) => now - entry.at < TTL_MS);
  if (pruned.length !== entries.length) {
    saveRaw(pruned);
  }
  return pruned;
}

function getWorkingMemory(): WorkingMemoryEntry[] {
  return pruneWorkingMemory();
}

export function recordWorkingEvent(input: {
  kind: WorkingMemoryKind;
  app?: string;
  title?: string;
  topic: string;
  at?: number;
}): void {
  const topic = input.topic.trim().slice(0, 280);
  if (!topic) return;

  const entries = pruneWorkingMemory();
  const last = entries[entries.length - 1];
  if (
    last &&
    last.kind === input.kind &&
    last.topic === topic &&
    last.app === input.app &&
    last.title === input.title &&
    Date.now() - last.at < 90_000
  ) {
    return;
  }

  entries.push({
    id: crypto.randomUUID(),
    kind: input.kind,
    app: input.app?.slice(0, 120),
    title: input.title?.slice(0, 200),
    topic,
    at: input.at ?? Date.now(),
  });
  saveRaw(entries);
}

export function summarizeWorkingMemory(
  now = Date.now(),
  windowMs = TTL_MS,
): WorkingMemorySummary {
  const entries = getWorkingMemory().filter(
    (entry) => now - entry.at <= windowMs,
  );
  const distinctApps = [
    ...new Set(entries.map((entry) => entry.app).filter(Boolean) as string[]),
  ];
  const windowSwitchCount = entries.filter(
    (entry) => entry.kind === "window_switch",
  ).length;

  const switchTimes = entries
    .filter((entry) => entry.kind === "window_switch")
    .map((entry) => entry.at);
  let rapidContextSwitches = 0;
  const rapidWindowMs = 5 * 60_000;
  const recentSwitches = switchTimes.filter((at) => now - at <= rapidWindowMs);
  if (recentSwitches.length >= 6) {
    rapidContextSwitches = recentSwitches.length;
  }

  const distractionCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== "distraction" || !entry.app) continue;
    distractionCounts.set(
      entry.app,
      (distractionCounts.get(entry.app) ?? 0) + 1,
    );
  }
  const distractionApps = [...distractionCounts.entries()]
    .map(([app, count]) => ({ app, count }))
    .sort((left, right) => right.count - left.count);

  return {
    distinctApps,
    windowSwitchCount,
    rapidContextSwitches,
    distractionApps,
    topDistraction: distractionApps[0],
  };
}

export function describeWorkingMemory(limit = 8): string {
  const entries = getWorkingMemory().slice(-limit);
  if (!entries.length) {
    return "";
  }

  return entries
    .map((entry) => {
      const when = new Date(entry.at).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const label = kindLabels[entry.kind];
      const prefix = label ? `[${label}] ` : "";
      const place =
        entry.app || entry.title
          ? ` (${[entry.app, entry.title].filter(Boolean).join(" — ")})`
          : "";
      return `- [${when}] ${prefix}${entry.topic}${place}`;
    })
    .join("\n");
}

