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

let ragChunksCache: RagChunk[] | null = null;
let ragChunkNorms: Map<string, number> | null = null;

export function invalidateRagChunksCache(): void {
  ragChunksCache = null;
  ragChunkNorms = null;
}

export function getRagChunkNorms(): Map<string, number> | null {
  return ragChunkNorms;
}

function buildChunkNorms(chunks: RagChunk[]): Map<string, number> {
  const norms = new Map<string, number>();
  for (const chunk of chunks) {
    let sum = 0;
    for (const value of chunk.embedding) {
      sum += value * value;
    }
    norms.set(chunk.id, Math.sqrt(sum) || 0);
  }
  return norms;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
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

export async function loadRagChunks(): Promise<RagChunk[]> {
  if (ragChunksCache) {
    return ragChunksCache;
  }

  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      database.close();
      ragChunksCache = request.result as RagChunk[];
      ragChunkNorms = buildChunkNorms(ragChunksCache);
      resolve(ragChunksCache);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
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
