import { normalizeComparableText } from "../platform/textNormalize";
import { notifyNew } from "../character/notifications";
import {
  addTask,
  completeTask,
  dismissTask,
  getDueTasks,
  loadTasks,
  markTaskReminded,
  reopenTask,
  snoozeTask,
  updateTask,
  type Task,
} from "../tasks/taskStore";
import { putMany, waitForTransaction } from "./idbUtils";

export type MemoryEpisode = {
  id: string;
  title: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export type OpenLoop = {
  id: string;
  text: string;
  status: "open" | "resolved";
  dueAt?: number;
  reminderState?: "scheduled" | "reminded" | "snoozed";
  lastRemindedAt?: number;
  snoozeCount?: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
};

export type NewOpenLoop = {
  text: string;
  dueAt?: number;
};

const DATABASE_NAME = "ari-episodes";
/** v2: repair DBs created at v1 without object stores (task migration race). */
const DATABASE_VERSION = 2;
const EPISODES_STORE = "episodes";

let episodesCache: MemoryEpisode[] | null = null;
let episodesLoadPromise: Promise<MemoryEpisode[]> | null = null;

function invalidateEpisodicCache(): void {
  episodesCache = null;
  episodesLoadPromise = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("ari-episodic-memory-changed", invalidateEpisodicCache);
  window.addEventListener("ari-tasks-changed", invalidateEpisodicCache);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EPISODES_STORE)) {
        database.createObjectStore(EPISODES_STORE, { keyPath: "id" });
      }
    };
    request.onblocked = () => {
      console.warn(
        "[ari-episodes] IndexedDB upgrade blocked by another connection",
      );
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadStore<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAll();
    request.onsuccess = () => {
      database.close();
      resolve(request.result as T[]);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

const putManyEpisodes = <T>(storeName: string, values: T[]) =>
  putMany(openDatabase, storeName, values);

async function remove(storeName: string, id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

function notifyChanged(): void {
  invalidateEpisodicCache();
  window.dispatchEvent(new Event("ari-episodic-memory-changed"));
}

function comparable(text: string): string {
  return normalizeComparableText(text);
}

function taskToOpenLoop(task: Task): OpenLoop {
  return {
    id: task.id,
    text: task.notes ?? task.title,
    status: task.status === "done" ? "resolved" : "open",
    dueAt: task.dueAt,
    reminderState: task.reminderState,
    lastRemindedAt: task.lastRemindedAt,
    snoozeCount: task.snoozeCount ?? 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    resolvedAt: task.resolvedAt,
  };
}

export async function loadEpisodes(): Promise<MemoryEpisode[]> {
  if (episodesCache) {
    return episodesCache;
  }
  if (!episodesLoadPromise) {
    episodesLoadPromise = loadStore<MemoryEpisode>(EPISODES_STORE)
      .then((episodes) =>
        episodes.sort((left, right) => right.updatedAt - left.updatedAt),
      )
      .then((episodes) => {
        episodesCache = episodes;
        return episodes;
      })
      .finally(() => {
        episodesLoadPromise = null;
      });
  }
  return episodesLoadPromise;
}

export async function loadOpenLoops(
  includeResolved = false,
): Promise<OpenLoop[]> {
  const statuses = includeResolved ? (["open", "done"] as const) : (["open"] as const);
  const tasks = loadTasks({
    status: [...statuses],
    kind: ["thread", "reminder"],
    includeDone: includeResolved,
  });
  return tasks.map(taskToOpenLoop).sort((left, right) => {
    if (left.status !== right.status) return left.status === "open" ? -1 : 1;
    if (left.dueAt && right.dueAt) return left.dueAt - right.dueAt;
    if (left.dueAt) return -1;
    if (right.dueAt) return 1;
    return right.updatedAt - left.updatedAt;
  });
}

export async function addEpisodes(
  values: Array<{ title: string; text: string }>,
): Promise<void> {
  const existing = await loadEpisodes();
  const known = new Set(existing.map(({ text }) => comparable(text)));
  const now = Date.now();
  const episodes = values.flatMap(({ title, text }): MemoryEpisode[] => {
    const normalized = text.trim().replace(/\s+/g, " ").slice(0, 1200);
    if (normalized.length < 12 || known.has(comparable(normalized))) return [];
    known.add(comparable(normalized));
    return [{
      id: crypto.randomUUID(),
      title: title.trim().slice(0, 120) || "Совместный эпизод",
      text: normalized,
      createdAt: now,
      updatedAt: now,
    }];
  });
  await putManyEpisodes(EPISODES_STORE, episodes);
  if (episodes.length) {
    notifyChanged();
    const settings = loadSettings();
    for (const episode of episodes) {
      void indexMemoryText(
        episode.id,
        `${episode.title} ${episode.text}`,
        "episode",
        settings,
      );
    }
  }
}

export async function addOpenLoops(
  values: Array<string | NewOpenLoop>,
): Promise<void> {
  const existing = await loadOpenLoops(true);
  const openByText = new Map(
    existing
      .filter(({ status }) => status === "open")
      .map((loop) => [comparable(loop.text), loop]),
  );
  let added = false;
  for (const value of values) {
    const rawText = typeof value === "string" ? value : value.text;
    const text = rawText.trim().replace(/\s+/g, " ").slice(0, 500);
    if (text.length < 6) continue;
    const dueAt =
      typeof value === "string" || !Number.isFinite(value.dueAt)
        ? undefined
        : value.dueAt;
    const key = comparable(text);
    const duplicate = openByText.get(key);
    if (duplicate) {
      if (dueAt && dueAt !== duplicate.dueAt) {
        updateTask(duplicate.id, { dueAt, reminderState: "scheduled" });
      }
      continue;
    }
    addTask({
      title: text.slice(0, 120),
      notes: text,
      kind: dueAt ? "reminder" : "thread",
      status: "open",
      priority: "normal",
      dueAt,
      source: "extracted",
    });
    added = true;
  }
  if (added) {
    notifyNew("open_thread", values[0]?.toString().slice(0, 80) ?? "нить");
  }
}

export async function resolveOpenLoops(ids: string[]): Promise<void> {
  for (const id of ids) {
    completeTask(id);
  }
}

export async function reopenLoop(id: string): Promise<void> {
  reopenTask(id);
}

export async function updateOpenLoopSchedule(
  id: string,
  dueAt?: number,
): Promise<void> {
  updateTask(id, {
    dueAt,
    reminderState: dueAt ? "scheduled" : undefined,
    snoozeCount: 0,
  });
}

export async function snoozeOpenLoop(
  id: string,
  delayMs: number,
): Promise<void> {
  snoozeTask(id, delayMs);
}

export async function markOpenLoopReminded(id: string): Promise<void> {
  markTaskReminded(id);
}

export async function loadDueOpenLoops(
  now = Date.now(),
): Promise<OpenLoop[]> {
  return getDueTasks(now).map(taskToOpenLoop);
}

export async function deleteEpisode(id: string): Promise<void> {
  await remove(EPISODES_STORE, id);
  notifyChanged();
}

export async function deleteOpenLoop(id: string): Promise<void> {
  dismissTask(id);
}

import {
  freshnessBonus,
  mixedRecallScore,
  overlapScore,
  queryWordSet,
  recallWeightsFromSettings,
} from "./memoryScoring";
import { indexMemoryText, scoreMemorySemantic } from "./memorySemanticIndex";
import type { AppSettings } from "../settings/appSettings";
import { loadSettings } from "../settings/appSettings";
import { selectOpenTaskContext } from "../tasks/taskStore";

export async function selectEpisodicContext(
  query: string,
  settings?: AppSettings,
): Promise<{ episodes: MemoryEpisode[]; openLoops: OpenLoop[] }> {
  const words = queryWordSet(query);
  const episodes = await loadEpisodes();
  const semanticScores = await scoreMemorySemantic(
    query,
    episodes.map((episode) => ({
      id: episode.id,
      text: `${episode.title} ${episode.text}`,
    })),
    settings,
  );
  const minRecall = settings?.memoryRelevanceFloor ?? 0.12;
  const recallWeights = recallWeightsFromSettings(settings);
  const openLoops = selectOpenTaskContext(query).map(taskToOpenLoop);

  return {
    episodes: episodes
      .map((episode, index) => {
        const lexical = overlapScore(`${episode.title} ${episode.text}`, words);
        const semantic = semanticScores.get(episode.id) ?? 0;
        const recall = mixedRecallScore(lexical, semantic, recallWeights);
        return {
          episode,
          recall,
          score:
            recall * 10 +
            freshnessBonus(episode.updatedAt) +
            1 / (index + 1),
        };
      })
      .filter(({ recall, episode }) => {
        const lexical = overlapScore(`${episode.title} ${episode.text}`, words);
        return recall >= minRecall || lexical >= 0.5;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)
      .map(({ episode }) => episode),
    openLoops,
  };
}

export async function clearEpisodicMemory(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([EPISODES_STORE], "readwrite");
    transaction.objectStore(EPISODES_STORE).clear();
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
  notifyChanged();
}
