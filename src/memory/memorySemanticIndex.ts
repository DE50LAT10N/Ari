import type { AppSettings } from "../settings/appSettings";
import { embedTexts } from "../rag/ragClient";
import { embedQueryCached } from "../llm/embeddingCache";
import { isEmbeddingSourceConfigured } from "../llm/embeddingConfig";
import { embeddingNorm } from "./memoryScoring";
import {
  buildIvfIndex,
  searchIvfIndex,
  searchVectorsLinear,
  type IndexedVector,
  type IvfIndex,
} from "./ivfIndex";
import { clearStoredIvfIndex, resolveIvfIndex } from "./ivfStore";
import type { RetrievalSearchMode } from "./retrievalTelemetry";

export type MemoryEmbeddingKind = "fact" | "episode";

export type MemoryEmbeddingEntry = {
  id: string;
  text: string;
  embedding: number[];
  kind: MemoryEmbeddingKind;
  updatedAt: number;
};

const DATABASE_NAME = "ari-memory-semantic";
const DATABASE_VERSION = 1;
const STORE = "embeddings";
const SEMANTIC_THRESHOLD = 0.18;

let databasePromise: Promise<IDBDatabase> | null = null;
let entriesCache: MemoryEmbeddingEntry[] | null = null;
let vectorCache: IndexedVector[] | null = null;
let ivfIndex: IvfIndex | null = null;
let lastMemorySearchMode: RetrievalSearchMode = "none";

export function getMemorySemanticSearchMode(): RetrievalSearchMode {
  return lastMemorySearchMode;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

function invalidateCache(): void {
  entriesCache = null;
  vectorCache = null;
  ivfIndex = null;
  lastMemorySearchMode = "none";
}

function toIndexedVector(entry: MemoryEmbeddingEntry): IndexedVector {
  return {
    id: entry.id,
    embedding: entry.embedding,
    norm: embeddingNorm(entry.embedding),
  };
}

async function loadAllEntries(): Promise<MemoryEmbeddingEntry[]> {
  if (entriesCache) {
    return entriesCache;
  }
  const database = await openDatabase();
  entriesCache = await new Promise<MemoryEmbeddingEntry[]>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () =>
      resolve((request.result as MemoryEmbeddingEntry[]) ?? []);
    request.onerror = () => reject(request.error);
  });
  return entriesCache;
}

async function getVectorIndex(
  settings?: AppSettings,
): Promise<{
  vectors: IndexedVector[];
  ivf: IvfIndex | null;
  searchMode: RetrievalSearchMode;
}> {
  if (vectorCache && ivfIndex) {
    return { vectors: vectorCache, ivf: ivfIndex, searchMode: lastMemorySearchMode };
  }
  const entries = await loadAllEntries();
  vectorCache = entries.map(toIndexedVector);
  const entryPayload = entries.map((entry) => ({
    id: entry.id,
    embedding: entry.embedding,
  }));
  if (settings && entryPayload.length > 0) {
    const resolved = await resolveIvfIndex("memory", settings, entryPayload);
    ivfIndex = resolved.index;
    lastMemorySearchMode = resolved.searchMode;
  } else {
    ivfIndex = buildIvfIndex(entryPayload);
    lastMemorySearchMode = ivfIndex ? "ivf" : "linear";
  }
  return { vectors: vectorCache, ivf: ivfIndex, searchMode: lastMemorySearchMode };
}

async function putEntry(entry: MemoryEmbeddingEntry): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  invalidateCache();
  void clearStoredIvfIndex("memory");
}

async function getEntriesByIds(ids: string[]): Promise<MemoryEmbeddingEntry[]> {
  if (!ids.length) {
    return [];
  }
  const all = await loadAllEntries();
  const wanted = new Set(ids);
  return all.filter((entry) => wanted.has(entry.id));
}

export async function indexMemoryText(
  id: string,
  text: string,
  kind: MemoryEmbeddingKind,
  settings?: AppSettings,
): Promise<void> {
  if (!settings || !isEmbeddingSourceConfigured(settings) || !text.trim()) {
    return;
  }
  try {
    const [embedding] = await embedTexts([text], settings);
    await putEntry({
      id,
      text: text.trim().slice(0, 500),
      embedding,
      kind,
      updatedAt: Date.now(),
    });
  } catch {
    // embeddings are optional — lexical recall still works
  }
}

export async function scoreMemorySemantic(
  query: string,
  items: Array<{ id: string; text: string }>,
  settings?: AppSettings,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!settings || !isEmbeddingSourceConfigured(settings) || !query.trim()) {
    return scores;
  }
  try {
    const queryEmbedding = await embedQueryCached(query, settings);
    const itemIds = new Set(items.map((item) => item.id));
    const { vectors, ivf } = await getVectorIndex(settings);
    const filtered = vectors.filter((vector) => itemIds.has(vector.id));

    const rawScores = ivf
      ? searchIvfIndex(queryEmbedding, ivf, SEMANTIC_THRESHOLD)
      : searchVectorsLinear(queryEmbedding, filtered, SEMANTIC_THRESHOLD);
    lastMemorySearchMode = ivf ? "ivf" : filtered.length ? "linear" : "none";

    for (const item of items) {
      const score = rawScores.get(item.id);
      if (score !== undefined) {
        scores.set(item.id, score);
      }
    }
  } catch {
    // graceful fallback to lexical-only scoring
  }
  return scores;
}

export async function getMemoryEmbeddingsByIds(
  ids: string[],
): Promise<Map<string, number[]>> {
  const entries = await getEntriesByIds(ids);
  return new Map(entries.map((entry) => [entry.id, entry.embedding]));
}

export function invalidateMemorySemanticCache(): void {
  invalidateCache();
  void clearStoredIvfIndex("memory");
}
