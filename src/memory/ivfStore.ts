import { resolveEmbeddingModel } from "../llm/embeddingConfig";
import type { AppSettings } from "../settings/appSettings";
import {
  buildIvfIndex,
  type IndexedVector,
  type IvfBucket,
  type IvfIndex,
} from "./ivfIndex";

export type IvfStoreKind = "memory" | "rag";

export type StoredIvfPayload = {
  kind: IvfStoreKind;
  model: string;
  entryCount: number;
  bucketCount: number;
  buckets: IvfBucket[];
  vectors: IndexedVector[];
  dimension: number;
  updatedAt: number;
};

const DATABASE_NAME = "ari-ivf-index";
const STORE = "indexes";
const DATABASE_VERSION = 1;

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "kind" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

function payloadToIndex(payload: StoredIvfPayload): IvfIndex {
  return {
    buckets: payload.buckets,
    byId: new Map(payload.vectors.map((vector) => [vector.id, vector])),
    dimension: payload.dimension,
  };
}

function indexToPayload(
  kind: IvfStoreKind,
  model: string,
  entryCount: number,
  index: IvfIndex,
): StoredIvfPayload {
  return {
    kind,
    model,
    entryCount,
    bucketCount: index.buckets.length,
    buckets: index.buckets,
    vectors: [...index.byId.values()],
    dimension: index.dimension,
    updatedAt: Date.now(),
  };
}

export async function loadStoredIvfIndex(
  kind: IvfStoreKind,
  settings: AppSettings,
  entryCount: number,
): Promise<IvfIndex | null> {
  try {
    const database = await openDatabase();
    const payload = await new Promise<StoredIvfPayload | null>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(kind);
      request.onsuccess = () =>
        resolve((request.result as StoredIvfPayload | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    if (!payload) {
      return null;
    }
    const model = resolveEmbeddingModel(settings);
    if (payload.model !== model || payload.entryCount !== entryCount) {
      return null;
    }
    return payloadToIndex(payload);
  } catch {
    return null;
  }
}

export async function saveStoredIvfIndex(
  kind: IvfStoreKind,
  settings: AppSettings,
  entryCount: number,
  index: IvfIndex,
): Promise<void> {
  try {
    const database = await openDatabase();
    const payload = indexToPayload(
      kind,
      resolveEmbeddingModel(settings),
      entryCount,
      index,
    );
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(payload);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // IVF persistence is optional
  }
}

export async function clearStoredIvfIndex(kind?: IvfStoreKind): Promise<void> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      if (kind) {
        store.delete(kind);
      } else {
        store.clear();
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // ignore
  }
}

export async function resolveIvfIndex(
  kind: IvfStoreKind,
  settings: AppSettings,
  entries: Array<{ id: string; embedding: number[] }>,
): Promise<{ index: IvfIndex | null; searchMode: "linear" | "ivf" }> {
  const built = buildIvfIndex(entries);
  if (!built) {
    return { index: null, searchMode: "linear" };
  }
  const stored = await loadStoredIvfIndex(kind, settings, entries.length);
  if (stored) {
    return { index: stored, searchMode: "ivf" };
  }
  void saveStoredIvfIndex(kind, settings, entries.length, built);
  return { index: built, searchMode: "ivf" };
}
