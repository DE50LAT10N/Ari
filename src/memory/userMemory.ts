export type UserMemoryFact = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  source: "automatic" | "manual";
  importance: MemoryImportance;
  confidence: number;
  lastSeenAt: number;
  consolidatedAt?: number;
  supersededAt?: number;
  supersededBy?: string;
};

export type MemoryImportance = "trivial" | "useful" | "important" | "core";

export type NewMemoryFact = {
  text: string;
  importance?: MemoryImportance;
  confidence?: number;
};

export type UserMemorySummary = {
  id: string;
  title: string;
  text: string;
  factIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type UserMemoryStats = {
  facts: number;
  activeFacts: number;
  summaries: number;
};

const DATABASE_NAME = "ari-memory";
const DATABASE_VERSION = 1;
const FACTS_STORE = "facts";
const SUMMARIES_STORE = "summaries";
const LEGACY_MEMORY_KEY = "desktop-character.user-memory.v1";
const MIGRATION_KEY = "desktop-character.user-memory-idb-migrated.v1";
let lastConflictDescription = "—";
let factsCache: UserMemoryFact[] | null = null;
let summariesCache: UserMemorySummary[] | null = null;

function invalidateUserMemoryCache(): void {
  factsCache = null;
  summariesCache = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("ari-memory-changed", invalidateUserMemoryCache);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FACTS_STORE)) {
        database.createObjectStore(FACTS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SUMMARIES_STORE)) {
        database.createObjectStore(SUMMARIES_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
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

async function putMany<T>(storeName: string, values: T[]): Promise<void> {
  if (!values.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  values.forEach((value) => store.put(value));
  await waitForTransaction(transaction);
  database.close();
}

function notifyMemoryChanged(): void {
  invalidateUserMemoryCache();
  window.dispatchEvent(new Event("ari-memory-changed"));
}

function comparable(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function initializeUserMemory(): Promise<void> {
  await openDatabase().then((database) => database.close());
  if (localStorage.getItem(MIGRATION_KEY)) return;

  try {
    const legacy = JSON.parse(
      localStorage.getItem(LEGACY_MEMORY_KEY) ?? "[]",
    ) as unknown;
    if (Array.isArray(legacy)) {
      const now = Date.now();
      const facts = legacy.flatMap((value): UserMemoryFact[] => {
        if (!value || typeof value !== "object") return [];
        const candidate = value as Partial<UserMemoryFact>;
        if (typeof candidate.text !== "string" || !candidate.text.trim()) {
          return [];
        }
        return [{
          id:
            typeof candidate.id === "string"
              ? candidate.id
              : crypto.randomUUID(),
          text: candidate.text.trim().slice(0, 500),
          source: candidate.source === "manual" ? "manual" : "automatic",
          importance: candidate.importance ?? "useful",
          confidence:
            typeof candidate.confidence === "number"
              ? candidate.confidence
              : candidate.source === "manual" ? 1 : 0.7,
          lastSeenAt:
            typeof candidate.lastSeenAt === "number"
              ? candidate.lastSeenAt
              : now,
          createdAt:
            typeof candidate.createdAt === "number"
              ? candidate.createdAt
              : now,
          updatedAt:
            typeof candidate.updatedAt === "number"
              ? candidate.updatedAt
              : now,
        }];
      });
      await putMany(FACTS_STORE, facts);
    }
  } finally {
    localStorage.setItem(MIGRATION_KEY, "1");
    localStorage.removeItem(LEGACY_MEMORY_KEY);
  }
}

export async function loadUserMemory(): Promise<UserMemoryFact[]> {
  if (factsCache) {
    return factsCache;
  }
  await initializeUserMemory();
  factsCache = (await getAll<UserMemoryFact>(FACTS_STORE)).map((fact) => ({
    ...fact,
    importance: fact.importance ?? "useful",
    confidence: fact.confidence ?? (fact.source === "manual" ? 1 : 0.7),
    lastSeenAt: fact.lastSeenAt ?? fact.updatedAt,
  })).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  return factsCache;
}

export async function loadUserMemorySummaries(): Promise<
  UserMemorySummary[]
> {
  if (summariesCache) {
    return summariesCache;
  }
  await initializeUserMemory();
  summariesCache = (await getAll<UserMemorySummary>(SUMMARIES_STORE)).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  return summariesCache;
}

export async function importMemorySummaries(
  summaries: UserMemorySummary[],
): Promise<void> {
  if (!summaries.length) return;
  await initializeUserMemory();
  await putMany(SUMMARIES_STORE, summaries);
  notifyMemoryChanged();
}

export async function addUserMemoryFacts(
  values: Array<string | NewMemoryFact>,
  source: UserMemoryFact["source"],
): Promise<{ added: UserMemoryFact[]; updated: UserMemoryFact[]; changed: boolean }> {
  const existing = await loadUserMemory();
  const now = Date.now();
  const added: UserMemoryFact[] = [];
  const updated: UserMemoryFact[] = [];

  for (const value of values) {
    const rawText = typeof value === "string" ? value : value.text;
    const importance =
      typeof value === "string"
        ? source === "manual"
          ? "important"
          : "useful"
        : value.importance ?? "useful";
    if (importance === "trivial") continue;
    const text = rawText.trim().replace(/\s+/g, " ").slice(0, 500);
    const key = comparable(text);
    if (text.length < 4) continue;
    const words = new Set(key.split(" ").filter((word) => word.length >= 3));
    const { resolveMemoryConflict } = await import("./memoryConflictResolver");
    const conflict = resolveMemoryConflict(
      text,
      existing.filter(({ supersededAt }) => !supersededAt),
    );
    lastConflictDescription = `${conflict.resolution}: ${conflict.reason}`;
    const duplicate = existing
      .map((fact) => {
        const factWords = new Set(
          comparable(fact.text).split(" ").filter((word) => word.length >= 3),
        );
        const overlap = [...words].filter((word) => factWords.has(word)).length;
        return {
          fact,
          similarity:
            words.size && factWords.size
              ? overlap / Math.min(words.size, factWords.size)
              : 0,
        };
      })
      .sort((left, right) => right.similarity - left.similarity)[0];
    if (duplicate && (duplicate.fact.text === text || duplicate.similarity >= 0.82)) {
      updated.push({
        ...duplicate.fact,
        confidence: Math.min(
          1,
          duplicate.fact.confidence +
            (typeof value === "string" ? 0.08 : value.confidence ?? 0.08),
        ),
        importance:
          importanceRank(importance) > importanceRank(duplicate.fact.importance)
            ? importance
            : duplicate.fact.importance,
        lastSeenAt: now,
        updatedAt: now,
      });
      continue;
    }
    if (
      conflict.resolution === "ask_user" &&
      conflict.conflictingFactIds.length
    ) {
      await queueMemoryConflict(conflict, text);
      continue;
    }
    const id = crypto.randomUUID();
    if (
      conflict.resolution === "replace" &&
      conflict.conflictingFactIds.length
    ) {
      updated.push(
        ...existing
          .filter(({ id: factId }) =>
            conflict.conflictingFactIds.includes(factId),
          )
          .map((fact) => ({
            ...fact,
            supersededAt: now,
            supersededBy: id,
            updatedAt: now,
          })),
      );
    }
    added.push({
      id,
      text,
      source,
      importance,
      confidence:
        typeof value === "string"
          ? source === "manual" ? 1 : 0.7
          : Math.max(0.1, Math.min(1, value.confidence ?? 0.7)),
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  await putMany(FACTS_STORE, [...updated, ...added]);
  if (added.length || updated.length) notifyMemoryChanged();
  const settings = loadSettings();
  for (const fact of [...added, ...updated.filter((fact) => added.every((entry) => entry.id !== fact.id))]) {
    void indexMemoryText(fact.id, fact.text, "fact", settings);
  }
  return {
    added,
    updated,
    changed: added.length > 0 || updated.length > 0,
  };
}

async function queueMemoryConflict(
  conflict: import("./memoryConflictResolver").MemoryConflict,
  sourceMessage?: string,
): Promise<void> {
  // Dynamic import breaks the userMemory <-> ariInbox static cycle.
  const { addToAriInbox } = await import("./ariInbox");
  const existingFacts = await loadUserMemory();
  const conflicting = existingFacts
    .filter((fact) => conflict.conflictingFactIds.includes(fact.id))
    .map((fact) => fact.text)
    .join(" | ");
  addToAriInbox({
    kind: "memory_conflict",
    title: "Конфликт памяти",
    body: conflict.newFact,
    sourceMessage,
    confidence: 0.6,
    reason: conflict.reason,
    metadata: {
      conflictingFacts: conflicting,
      conflictingIds: conflict.conflictingFactIds.join(","),
    },
  });
}

export async function updateUserMemoryFact(
  id: string,
  text: string,
): Promise<void> {
  const normalized = text.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!normalized) {
    await removeUserMemoryFact(id);
    return;
  }
  const facts = await loadUserMemory();
  const fact = facts.find((item) => item.id === id);
  if (!fact) return;
  await invalidateSummariesForFact(id);
  await putMany(FACTS_STORE, [{
    ...fact,
    text: normalized,
    confidence: 1,
    lastSeenAt: Date.now(),
    updatedAt: Date.now(),
    consolidatedAt: undefined,
  }]);
  notifyMemoryChanged();
}

async function deleteFromStore(storeName: string, id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(id);
  await waitForTransaction(transaction);
  database.close();
}

async function invalidateSummariesForFact(factId: string): Promise<void> {
  const summaries = await loadUserMemorySummaries();
  const affected = summaries.filter(({ factIds }) =>
    factIds.includes(factId),
  );
  if (!affected.length) return;

  const affectedFactIds = new Set(
    affected.flatMap(({ factIds }) => factIds),
  );
  const facts = await loadUserMemory();
  await putMany(
    FACTS_STORE,
    facts
      .filter(({ id }) => id !== factId && affectedFactIds.has(id))
      .map((fact) => ({ ...fact, consolidatedAt: undefined })),
  );
  await Promise.all(
    affected.map(({ id }) => deleteFromStore(SUMMARIES_STORE, id)),
  );
}

export async function removeUserMemoryFact(id: string): Promise<void> {
  await invalidateSummariesForFact(id);
  await deleteFromStore(FACTS_STORE, id);
  notifyMemoryChanged();
}

export async function clearUserMemory(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [FACTS_STORE, SUMMARIES_STORE],
    "readwrite",
  );
  transaction.objectStore(FACTS_STORE).clear();
  transaction.objectStore(SUMMARIES_STORE).clear();
  await waitForTransaction(transaction);
  database.close();
  notifyMemoryChanged();
}

export async function saveMemorySummary(
  summary: UserMemorySummary,
  facts: UserMemoryFact[],
): Promise<void> {
  const now = Date.now();
  await putMany(SUMMARIES_STORE, [summary]);
  await putMany(
    FACTS_STORE,
    facts.map((fact) => ({ ...fact, consolidatedAt: now })),
  );
  notifyMemoryChanged();
}

export async function getFactsForConsolidation(
  threshold = 100,
  batchSize = 60,
): Promise<UserMemoryFact[]> {
  const facts = (await loadUserMemory())
    .filter(({ consolidatedAt, supersededAt }) => !consolidatedAt && !supersededAt)
    .sort((left, right) => left.createdAt - right.createdAt);
  return facts.length >= threshold ? facts.slice(0, batchSize) : [];
}

import {
  freshnessBonus,
  mixedRecallScore,
  overlapScore,
  queryWordSet,
  recallWeightsFromSettings,
} from "./memoryScoring";
import { indexMemoryText, scoreMemorySemantic } from "./memorySemanticIndex";
import { loadSettings, type AppSettings } from "../settings/appSettings";

export function importanceRank(importance: MemoryImportance): number {
  return { trivial: 0, useful: 1, important: 2, core: 3 }[importance];
}

export async function supersedeMemoryFacts(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const facts = await loadUserMemory();
  const now = Date.now();
  const idSet = new Set(ids);
  const updated = facts
    .filter((fact) => idSet.has(fact.id))
    .map((fact) => ({
      ...fact,
      supersededAt: now,
      updatedAt: now,
    }));
  if (!updated.length) return;
  await putMany(FACTS_STORE, updated);
  notifyMemoryChanged();
}

export async function markFactsRecalled(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const facts = await loadUserMemory();
  const idSet = new Set(ids);
  const now = Date.now();
  const updated = facts.filter((fact) => idSet.has(fact.id));
  if (!updated.length) return;
  await putMany(
    FACTS_STORE,
    updated.map((fact) => ({ ...fact, lastSeenAt: now, updatedAt: now })),
  );
  notifyMemoryChanged();
}

export async function selectUserMemoryContext(
  query: string,
  factLimit = 18,
  summaryLimit = 6,
  settings?: AppSettings,
): Promise<{ facts: UserMemoryFact[]; summaries: UserMemorySummary[] }> {
  const words = queryWordSet(query);
  const [facts, summaries] = await Promise.all([
    loadUserMemory(),
    loadUserMemorySummaries(),
  ]);

  const activeFacts = facts.filter(({ supersededAt }) => !supersededAt);
  const semanticScores = await scoreMemorySemantic(
    query,
    activeFacts.map((fact) => ({ id: fact.id, text: fact.text })),
    settings,
  );

  const minRecall = settings?.memoryRelevanceFloor ?? 0.12;
  const recallWeights = recallWeightsFromSettings(settings);

  const rankedFacts = activeFacts
    .map((fact, index) => {
      const lexical = overlapScore(fact.text, words);
      const semantic = semanticScores.get(fact.id) ?? 0;
      const recall = mixedRecallScore(lexical, semantic, recallWeights);
      return {
        fact,
        recall,
        score:
          recall * 10 +
          importanceRank(fact.importance) * 4 +
          fact.confidence * 2 +
          freshnessBonus(fact.lastSeenAt || fact.updatedAt) +
          (fact.consolidatedAt ? 0 : 2) +
          1 / (index + 1),
      };
    })
    .filter(({ recall, fact }) => {
      const lexical = overlapScore(fact.text, words);
      return recall >= minRecall || lexical >= 0.5;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, factLimit)
    .map(({ fact }) => fact);

  void markFactsRecalled(rankedFacts.map((fact) => fact.id));

  return {
    facts: rankedFacts,
    summaries: summaries
      .map((summary, index) => {
        const lexical = overlapScore(`${summary.title} ${summary.text}`, words);
        return {
          summary,
          lexical,
          score:
            lexical * 10 +
            freshnessBonus(summary.updatedAt) +
            1 / (index + 1),
        };
      })
      .filter(({ lexical }) => lexical >= 0.5)
      .sort((left, right) => right.score - left.score)
      .slice(0, summaryLimit)
      .map(({ summary }) => summary),
  };
}

export function dedupeFactsAgainstSummaries(
  facts: UserMemoryFact[],
  summaries: UserMemorySummary[],
): UserMemoryFact[] {
  const coveredIds = new Set(summaries.flatMap((summary) => summary.factIds));
  if (!coveredIds.size) {
    return facts;
  }
  return facts.filter((fact) => !coveredIds.has(fact.id));
}

export function getLastMemoryConflictDescription(): string {
  return lastConflictDescription;
}

export async function getUserMemoryStats(): Promise<UserMemoryStats> {
  const [facts, summaries] = await Promise.all([
    loadUserMemory(),
    loadUserMemorySummaries(),
  ]);
  return {
    facts: facts.length,
    activeFacts: facts.filter(
      ({ consolidatedAt, supersededAt }) => !consolidatedAt && !supersededAt,
    ).length,
    summaries: summaries.length,
  };
}
