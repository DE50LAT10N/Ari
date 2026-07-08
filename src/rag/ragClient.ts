import { fetch } from "@tauri-apps/plugin-http";
import type { AppSettings } from "../settings/appSettings";
import {
  loadRagChunks,
  saveRagChunks,
  getRagChunkNorms,
  invalidateRagChunksCache,
  type RagChunk,
} from "./ragStore";
import {
  getEmbeddingSource,
  isEmbeddingSourceConfigured,
  resolveEmbeddingModel,
} from "../llm/embeddingConfig";
import { createGigaChatEmbeddings } from "../llm/gigaChatClient";
import { formatOllamaError } from "../llm/ollamaErrors";
import { embeddingNorm, cosineSimilarityWithNorms } from "../memory/memoryScoring";
import { yieldToMain } from "../platform/asyncTimeout";
import { embedQueryCached } from "../llm/embeddingCache";
import { withTimeout } from "../platform/asyncTimeout";
import { httpErrorFromResponse, parseJsonSafe } from "../platform/httpUtils";
import { searchIvfIndex, type IvfIndex } from "../memory/ivfIndex";
import { clearStoredIvfIndex, resolveIvfIndex } from "../memory/ivfStore";
import type { RetrievalSearchMode } from "../memory/retrievalTelemetry";
import { logError } from "../platform/logger";

type EmbedResponse = {
  embeddings?: unknown;
  error?: unknown;
};

export type RagMatch = {
  source: string;
  text: string;
  score: number;
  id?: string;
};

let ragIvfIndex: IvfIndex | null = null;
let ragIvfSourceLength = 0;
let lastRagSearchMode: RetrievalSearchMode = "none";

export function getRagSearchMode(): RetrievalSearchMode {
  return lastRagSearchMode;
}

async function buildRagVectorIndex(
  chunks: RagChunk[],
  settings: AppSettings,
): Promise<IvfIndex | null> {
  if (chunks.length !== ragIvfSourceLength || !ragIvfIndex) {
    const resolved = await resolveIvfIndex(
      "rag",
      settings,
      chunks.map((chunk) => ({ id: chunk.id, embedding: chunk.embedding })),
    );
    ragIvfIndex = resolved.index;
    lastRagSearchMode = resolved.searchMode;
    ragIvfSourceLength = chunks.length;
  }
  return ragIvfIndex;
}

export function invalidateRagSearchIndex(): void {
  ragIvfIndex = null;
  ragIvfSourceLength = 0;
  lastRagSearchMode = "none";
  void clearStoredIvfIndex("rag");
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const chunks: string[] = [];
  const size = 1200;
  const overlap = 200;

  for (let start = 0; start < normalized.length; start += size - overlap) {
    const roughEnd = Math.min(start + size, normalized.length);
    let end = roughEnd;

    if (roughEnd < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf("\n", roughEnd),
        normalized.lastIndexOf(". ", roughEnd),
      );
      if (boundary > start + size / 2) {
        end = boundary + 1;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) {
      break;
    }
    start = end - (size - overlap);
  }

  return chunks;
}

export async function embedTexts(
  input: string[],
  settings: AppSettings,
): Promise<number[][]> {
  const source = getEmbeddingSource(settings);
  if (source === "none") {
    throw new Error(
      "Embeddings отключены. Выбери GigaChat API или Ollama в настройках RAG.",
    );
  }
  if (source === "gigachat") {
    return createGigaChatEmbeddings(input, settings);
  }
  const response = await withTimeout(
    fetch(`${settings.ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: resolveEmbeddingModel(settings),
        input,
        truncate: true,
      }),
    }),
    25_000,
    "Ollama embeddings",
  );
  const raw = await response.text();
  const body = parseJsonSafe<EmbedResponse>(raw, {});

  if (!response.ok) {
    const detail =
      typeof body.error === "string" ? body.error : raw;
    const error = formatOllamaError(
      response.status,
      detail || httpErrorFromResponse(response.status, raw, "Ollama embeddings"),
    );
    throw new Error(`Не удалось создать embeddings: ${error.message}`);
  }

  if (
    !Array.isArray(body.embeddings) ||
    !body.embeddings.every(
      (embedding) =>
        Array.isArray(embedding) &&
        embedding.every((value) => typeof value === "number"),
    )
  ) {
    throw new Error("Ollama вернула некорректный ответ embeddings.");
  }

  return body.embeddings as number[][];
}

export async function indexDocument(
  source: string,
  text: string,
  settings: AppSettings,
): Promise<number> {
  if (!isEmbeddingSourceConfigured(settings)) {
    throw new Error(
      "Embeddings отключены. Выбери GigaChat API или Ollama в настройках RAG.",
    );
  }
  const pieces = chunkText(text);
  if (pieces.length === 0) {
    throw new Error("В документе нет текста для индексации.");
  }

  const stored: RagChunk[] = [];
  for (let offset = 0; offset < pieces.length; offset += 16) {
    const batch = pieces.slice(offset, offset + 16);
    const embeddings = await embedTexts(batch, settings);
    const createdAt = Date.now();
    batch.forEach((piece, index) => {
      stored.push({
        id: `${createdAt}-${offset + index}-${crypto.randomUUID()}`,
        source,
        text: piece,
        embedding: embeddings[index],
        createdAt,
      });
    });
  }

  await saveRagChunks(stored);
  invalidateRagSearchIndex();
  invalidateRagChunksCache();
  return stored.length;
}

export async function searchRag(
  query: string,
  settings: AppSettings,
): Promise<RagMatch[]> {
  try {
    return await withTimeout(
      searchRagInner(query, settings),
      45_000,
      "RAG поиск",
    );
  } catch (error) {
    logError("RAG search failed", error);
    return [];
  }
}

async function searchRagInner(
  query: string,
  settings: AppSettings,
): Promise<RagMatch[]> {
  if (!settings.ragEnabled || !query.trim()) {
    return [];
  }
  if (!isEmbeddingSourceConfigured(settings)) {
    return [];
  }

  const chunks = await loadRagChunks();
  if (chunks.length === 0) {
    return [];
  }

  const threshold = settings.ragScoreThreshold ?? 0.2;
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQueryCached(query, settings);
  } catch (error) {
    const model = resolveEmbeddingModel(settings);
    const detail =
      error instanceof Error ? error.message : "неизвестная ошибка embeddings";
    logError(`RAG embedding failed (${model})`, detail);
    return [];
  }
  const queryNorm = embeddingNorm(queryEmbedding);
  const chunkNorms = getRagChunkNorms();
  const ivf = await buildRagVectorIndex(chunks, settings);

  if (ivf) {
    lastRagSearchMode = "ivf";
    const scores = searchIvfIndex(queryEmbedding, ivf, threshold);
    return chunks
      .filter((chunk) => scores.has(chunk.id))
      .map((chunk) => ({
        id: chunk.id,
        source: chunk.source,
        text: chunk.text,
        score: scores.get(chunk.id) ?? 0,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, settings.ragTopK);
  }

  lastRagSearchMode = "linear";
  return searchRagLinear(
    chunks,
    queryEmbedding,
    queryNorm,
    chunkNorms,
    threshold,
    settings.ragTopK,
  );
}

const RAG_LINEAR_BATCH = 150;

async function searchRagLinear(
  chunks: RagChunk[],
  queryEmbedding: number[],
  queryNorm: number,
  chunkNorms: Map<string, number> | null,
  threshold: number,
  topK: number,
): Promise<RagMatch[]> {
  const scored: RagMatch[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const chunkNorm =
      chunkNorms?.get(chunk.id) ?? embeddingNorm(chunk.embedding);
    const score = cosineSimilarityWithNorms(
      queryEmbedding,
      queryNorm,
      chunk.embedding,
      chunkNorm,
    );
    if (score > threshold) {
      scored.push({
        id: chunk.id,
        source: chunk.source,
        text: chunk.text,
        score,
      });
    }
    if (index > 0 && index % RAG_LINEAR_BATCH === 0) {
      await yieldToMain();
    }
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}
