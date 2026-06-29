import type { AppSettings } from "../settings/appSettings";
import {
  getEmbeddingSource,
  resolveEmbeddingModel,
} from "./embeddingConfig";
import { embedTexts } from "../rag/ragClient";

const MAX_ENTRIES = 32;

type CacheEntry = {
  embedding: number[];
  at: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<number[]>>();

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(query: string, settings: AppSettings): string {
  const source = getEmbeddingSource(settings);
  const model = resolveEmbeddingModel(settings);
  return `${source}:${model}:${normalizeQuery(query)}`;
}

function ttlMs(settings: AppSettings): number {
  const seconds = settings.embeddingQueryCacheTtlSec ?? 300;
  return Math.max(30, seconds) * 1000;
}

function trimCache(): void {
  if (cache.size <= MAX_ENTRIES) {
    return;
  }
  const oldest = [...cache.entries()].sort(
    (left, right) => left[1].at - right[1].at,
  )[0];
  if (oldest) {
    cache.delete(oldest[0]);
  }
}

export function clearEmbeddingQueryCache(): void {
  cache.clear();
  inFlight.clear();
}

export async function embedQueryCached(
  query: string,
  settings: AppSettings,
): Promise<number[]> {
  const trimmed = normalizeQuery(query);
  if (!trimmed) {
    return [];
  }

  const key = cacheKey(trimmed, settings);
  const ttl = ttlMs(settings);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    return hit.embedding;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const promise = embedTexts([trimmed], settings)
    .then(([embedding]) => {
      cache.set(key, { embedding, at: Date.now() });
      inFlight.delete(key);
      trimCache();
      return embedding;
    })
    .catch((error) => {
      inFlight.delete(key);
      throw error;
    });

  inFlight.set(key, promise);
  return promise;
}
