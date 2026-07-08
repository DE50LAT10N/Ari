import { embeddingNorm } from "../memory/memoryScoring";
import { yieldToMain } from "../platform/asyncTimeout";
import { ariLog } from "../platform/logger";

export type RagChunk = {
  id: string;
  source: string;
  text: string;
  embedding: number[];
  createdAt: number;
};

const DATABASE_NAME = "ari-rag";
const STORE_NAME = "chunks";
const DATABASE_VERSION = 1;
const IDB_OPEN_TIMEOUT_MS = 12_000;

let ragChunksCache: RagChunk[] | null = null;
let ragChunkNorms: Map<string, number> | null = null;
let ragChunksLoadPromise: Promise<RagChunk[]> | null = null;

export function invalidateRagChunksCache(): void {
  ragChunksCache = null;
  ragChunkNorms = null;
  ragChunksLoadPromise = null;
}

export function getRagChunkNorms(): Map<string, number> | null {
  return ragChunkNorms;
}

async function buildChunkNormsAsync(chunks: RagChunk[]): Promise<Map<string, number>> {
  const norms = new Map<string, number>();
  const batchSize = 200;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    norms.set(chunk.id, embeddingNorm(chunk.embedding));
    if (index > 0 && index % batchSize === 0) {
      await yieldToMain();
    }
  }
  return norms;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("ari-rag: превышено время открытия IndexedDB"));
    }, IDB_OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onblocked = () => {
      ariLog("rag", "warn", {
        message: "IndexedDB upgrade blocked by another connection",
      });
    };
    request.onsuccess = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      reject(request.error);
    };
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveRagChunks(chunks: RagChunk[]): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  chunks.forEach((chunk) => store.put(chunk));
  await waitForTransaction(transaction);
  database.close();
  invalidateRagChunksCache();
}

async function loadRagChunksInner(): Promise<RagChunk[]> {
  const database = await openDatabase();

  const chunks = await new Promise<RagChunk[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      resolve(request.result as RagChunk[]);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
  database.close();

  ragChunksCache = chunks;
  ragChunkNorms = await buildChunkNormsAsync(chunks);
  return chunks;
}

export async function loadRagChunks(): Promise<RagChunk[]> {
  if (ragChunksCache) {
    return ragChunksCache;
  }
  if (!ragChunksLoadPromise) {
    ragChunksLoadPromise = loadRagChunksInner().finally(() => {
      ragChunksLoadPromise = null;
    });
  }
  return ragChunksLoadPromise;
}

export async function clearRagChunks(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();
  await waitForTransaction(transaction);
  database.close();
  invalidateRagChunksCache();
}

export async function getRagStats(): Promise<{
  chunks: number;
  sources: number;
}> {
  const chunks = await loadRagChunks();
  return {
    chunks: chunks.length,
    sources: new Set(chunks.map(({ source }) => source)).size,
  };
}
