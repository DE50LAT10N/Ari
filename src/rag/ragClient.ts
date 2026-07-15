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
import {
  normalizeDocumentSourceName,
  type RagSearchPlan,
} from "./ragQueryBuilder";
import { buildBm25Index, scoreBm25 } from "./bm25";

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

export type RagSearchResult = {
  matches: RagMatch[];
  error?: string;
  embeddingModel?: string;
  chunkCount: number;
  searchMode: RetrievalSearchMode;
  searchQueries?: string[];
  lexicalHits?: number;
  bm25Hits?: number;
};

export type RagSearchOptions = {
  plan?: RagSearchPlan;
};

export type RagSearchDiagnostics = {
  at: number;
  query: string;
  matches: number;
  error?: string;
  embeddingModel?: string;
  chunkCount: number;
  searchMode: RetrievalSearchMode;
  searchQueries?: string[];
  lexicalHits?: number;
  bm25Hits?: number;
};

let ragIvfIndex: IvfIndex | null = null;
let ragIvfSourceLength = 0;
let lastRagSearchMode: RetrievalSearchMode = "none";
let lastRagSearchDiagnostics: RagSearchDiagnostics | null = null;
let ragBm25Index: ReturnType<typeof buildBm25Index> | null = null;
let ragBm25SourceLength = 0;

export function getRagSearchMode(): RetrievalSearchMode {
  return lastRagSearchMode;
}

export function getLastRagSearchDiagnostics(): RagSearchDiagnostics | null {
  return lastRagSearchDiagnostics;
}

function recordRagDiagnostics(
  query: string,
  result: RagSearchResult,
): void {
  lastRagSearchDiagnostics = {
    at: Date.now(),
    query: query.trim().slice(0, 200),
    matches: result.matches.length,
    error: result.error,
    embeddingModel: result.embeddingModel,
    chunkCount: result.chunkCount,
    searchMode: result.searchMode,
    searchQueries: result.searchQueries,
    lexicalHits: result.lexicalHits,
    bm25Hits: result.bm25Hits,
  };
}

function emptyRagResult(
  chunkCount = 0,
  searchMode: RetrievalSearchMode = "none",
  error?: string,
  embeddingModel?: string,
): RagSearchResult {
  return {
    matches: [],
    error,
    embeddingModel,
    chunkCount,
    searchMode,
  };
}

function validateChunkDimensions(
  chunks: RagChunk[],
  queryEmbedding: number[],
): string | null {
  const queryDim = queryEmbedding.length;
  if (queryDim === 0) {
    return "Embedding запроса пустой.";
  }
  const mismatched = chunks.find(
    (chunk) => chunk.embedding.length > 0 && chunk.embedding.length !== queryDim,
  );
  if (!mismatched) {
    return null;
  }
  return `Размерность векторов в индексе (${mismatched.embedding.length}) не совпадает с текущей моделью (${queryDim}). Очисти и заново проиндексируй документы.`;
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
  ragBm25Index = null;
  ragBm25SourceLength = 0;
  void clearStoredIvfIndex("rag");
}

function getBm25Index(chunks: RagChunk[]): ReturnType<typeof buildBm25Index> {
  if (!ragBm25Index || ragBm25SourceLength !== chunks.length) {
    ragBm25Index = buildBm25Index(
      chunks.map((chunk) => ({ id: chunk.id, text: chunk.text })),
    );
    ragBm25SourceLength = chunks.length;
  }
  return ragBm25Index;
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
  options?: RagSearchOptions,
): Promise<RagSearchResult> {
  try {
    const result = await withTimeout(
      searchRagInner(query, settings, options),
      45_000,
      "RAG поиск",
    );
    recordRagDiagnostics(query, result);
    return result;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "неизвестная ошибка RAG";
    logError("RAG search failed", error);
    const failed = emptyRagResult(0, "none", detail, resolveEmbeddingModel(settings));
    recordRagDiagnostics(query, failed);
    return failed;
  }
}

async function searchRagInner(
  query: string,
  settings: AppSettings,
  options?: RagSearchOptions,
): Promise<RagSearchResult> {
  const embeddingModel = resolveEmbeddingModel(settings);
  const plan = options?.plan;
  const useHybrid = shouldUseHybridSearch(plan);

  if (!settings.ragEnabled || !query.trim()) {
    return emptyRagResult(0, "none");
  }
  if (!isEmbeddingSourceConfigured(settings)) {
    return emptyRagResult(
      0,
      "none",
      "Embeddings отключены в настройках.",
      embeddingModel,
    );
  }

  const chunks = await loadRagChunks();
  if (chunks.length === 0) {
    return emptyRagResult(0, "none", undefined, embeddingModel);
  }

  const threshold = settings.ragScoreThreshold ?? 0.2;
  const effectiveThreshold =
    useHybrid && plan ? Math.max(0.08, threshold - 0.1) : threshold;
  const effectiveTopK =
    useHybrid && plan
      ? Math.min(8, (settings.ragTopK ?? 4) + 2)
      : (settings.ragTopK ?? 4);
  const searchQueries = plan?.queries.length ? plan.queries : [query.trim()];

  if (useHybrid && plan) {
    return searchRagHybridInner(
      query,
      settings,
      plan,
      chunks,
      effectiveThreshold,
      effectiveTopK,
      embeddingModel,
    );
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQueryCached(query, settings);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "неизвестная ошибка embeddings";
    logError(`RAG embedding failed (${embeddingModel})`, detail);
    return emptyRagResult(
      chunks.length,
      "none",
      `Embedding не удался (${embeddingModel}): ${detail}`,
      embeddingModel,
    );
  }

  const dimensionError = validateChunkDimensions(chunks, queryEmbedding);
  if (dimensionError) {
    return emptyRagResult(
      chunks.length,
      "none",
      dimensionError,
      embeddingModel,
    );
  }

  const queryNorm = embeddingNorm(queryEmbedding);
  const chunkNorms = getRagChunkNorms();
  const ivf = await buildRagVectorIndex(chunks, settings);

  if (ivf) {
    if (ivf.dimension > 0 && ivf.dimension !== queryEmbedding.length) {
      return emptyRagResult(
        chunks.length,
        "ivf",
        `IVF-индекс (${ivf.dimension}) не совпадает с текущей моделью (${queryEmbedding.length}). Переиндексируй документы.`,
        embeddingModel,
      );
    }
    lastRagSearchMode = "ivf";
    const scores = searchIvfIndex(queryEmbedding, ivf, threshold);
    return {
      matches: chunks
        .filter((chunk) => scores.has(chunk.id))
        .map((chunk) => ({
          id: chunk.id,
          source: chunk.source,
          text: chunk.text,
          score: scores.get(chunk.id) ?? 0,
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, settings.ragTopK),
      embeddingModel,
      chunkCount: chunks.length,
      searchMode: "ivf",
      searchQueries,
    };
  }

  lastRagSearchMode = "linear";
  return {
    matches: await searchRagLinear(
      chunks,
      queryEmbedding,
      queryNorm,
      chunkNorms,
      threshold,
      settings.ragTopK,
    ),
    embeddingModel,
    chunkCount: chunks.length,
    searchMode: "linear",
    searchQueries,
  };
}

function shouldUseHybridSearch(plan?: RagSearchPlan): boolean {
  return Boolean(plan);
}

function findLexicalRagMatches(
  chunks: RagChunk[],
  plan: RagSearchPlan,
): RagMatch[] {
  if (!plan.documentHint && plan.itemNumber === undefined) {
    return [];
  }

  let candidates = chunks;
  if (plan.documentHint) {
    const hint = normalizeDocumentSourceName(plan.documentHint);
    candidates = candidates.filter((chunk) => {
      const source = normalizeDocumentSourceName(chunk.source);
      return source.includes(hint) || hint.includes(source);
    });
  }

  if (plan.itemNumber !== undefined) {
    const number = plan.itemNumber;
    const patterns = [
      new RegExp(`(?:^|\\n)\\s*${number}[.)]\\s`, "im"),
      new RegExp(`вопрос\\s*№?\\s*${number}\\b`, "i"),
      new RegExp(`№\\s*${number}\\b`, "i"),
    ];
    candidates = candidates.filter((chunk) =>
      patterns.some((pattern) => pattern.test(chunk.text)),
    );
  }

  const score =
    plan.itemNumber !== undefined
      ? 0.95
      : plan.documentHint
        ? 0.7
        : 0.55;
  return candidates.map((chunk) => ({
    id: chunk.id,
    source: chunk.source,
    text: chunk.text,
    score,
  }));
}

function mergeRagMatches(
  semantic: RagMatch[],
  lexical: RagMatch[],
  topK: number,
): { matches: RagMatch[]; lexicalHits: number } {
  if (lexical.length > 0) {
    // If lexical hits exist, ensure they stay on top even if semantic ranks something else higher.
    const semanticMap = new Map<string, RagMatch>();
    for (const match of semantic) {
      const key = match.id ?? `${match.source}:${match.text}`;
      semanticMap.set(key, match);
    }
    const picked: Array<RagMatch & { __lexical?: boolean }> = [];
    for (const match of lexical) {
      const key = match.id ?? `${match.source}:${match.text}`;
      const semanticMatch = semanticMap.get(key);
      picked.push({
        ...match,
        score: Math.max(match.score, semanticMatch?.score ?? 0),
        __lexical: true,
      });
      semanticMap.delete(key);
    }
    for (const match of semanticMap.values()) {
      picked.push({ ...match, __lexical: false });
    }
    return {
      matches: picked
        .sort((left, right) => {
          const lexicalDelta = Number(Boolean(right.__lexical)) - Number(Boolean(left.__lexical));
          if (lexicalDelta !== 0) {
            return lexicalDelta;
          }
          return right.score - left.score;
        })
        .slice(0, topK),
      lexicalHits: lexical.length,
    };
  }

  const merged = new Map<string, RagMatch>();
  for (const match of semantic) {
    const key = match.id ?? `${match.source}:${match.text}`;
    merged.set(key, match);
  }
  for (const match of lexical) {
    const key = match.id ?? `${match.source}:${match.text}`;
    const existing = merged.get(key);
    merged.set(key, {
      ...match,
      score: Math.max(match.score, existing?.score ?? 0),
    });
  }
  return {
    matches: [...merged.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, topK),
    lexicalHits: lexical.length,
  };
}

async function searchRagHybridInner(
  query: string,
  settings: AppSettings,
  plan: RagSearchPlan,
  chunks: RagChunk[],
  threshold: number,
  topK: number,
  embeddingModel: string,
): Promise<RagSearchResult> {
  const searchQueries = plan.queries.length ? plan.queries : [query.trim()];
  const primaryQuery = searchQueries[0] ?? query.trim();

  let primaryEmbedding: number[];
  try {
    primaryEmbedding = await embedQueryCached(primaryQuery, settings);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "неизвестная ошибка embeddings";
    logError(`RAG embedding failed (${embeddingModel})`, detail);
    return emptyRagResult(
      chunks.length,
      "none",
      `Embedding не удался (${embeddingModel}): ${detail}`,
      embeddingModel,
    );
  }

  const dimensionError = validateChunkDimensions(chunks, primaryEmbedding);
  if (dimensionError) {
    return emptyRagResult(
      chunks.length,
      "none",
      dimensionError,
      embeddingModel,
    );
  }

  const semanticMatches = await searchRagLinearMultiQuery(
    chunks,
    searchQueries,
    settings,
    threshold,
    topK,
  );
  const lexicalMatches = findLexicalRagMatches(chunks, plan);
  const bm25Matches = scoreBm25Matches(chunks, plan, searchQueries, topK);
  const merged = mergeRagMatches(
    semanticMatches,
    [...lexicalMatches, ...bm25Matches],
    topK,
  );
  lastRagSearchMode = "linear";

  return {
    matches: merged.matches,
    embeddingModel,
    chunkCount: chunks.length,
    searchMode: "linear",
    searchQueries,
    lexicalHits: merged.lexicalHits,
    bm25Hits: bm25Matches.length,
  };
}

function scoreBm25Matches(
  chunks: RagChunk[],
  plan: RagSearchPlan,
  queries: string[],
  topK: number,
): RagMatch[] {
  const index = getBm25Index(chunks);
  const lexicalWeight = 0.55;

  let filterIds: Set<string> | undefined;
  if (plan.documentHint) {
    const hint = normalizeDocumentSourceName(plan.documentHint);
    const filtered = chunks
      .filter((chunk) => {
        const source = normalizeDocumentSourceName(chunk.source);
        return source.includes(hint) || hint.includes(source);
      })
      .map((chunk) => chunk.id);
    if (filtered.length > 0) {
      filterIds = new Set(filtered);
    }
  }

  const best = new Map<string, number>();
  const querySlice = queries.slice(0, 2);
  for (const query of querySlice) {
    const scored = scoreBm25(index, query, {
      topK: Math.max(24, topK * 4),
      filterIds,
    });
    for (const item of scored) {
      const blended = item.score * lexicalWeight;
      best.set(item.id, Math.max(best.get(item.id) ?? 0, blended));
    }
  }

  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const itemNumber = plan.itemNumber;
  const itemLinePattern =
    itemNumber !== undefined
      ? new RegExp(`(?:^|\\n)\\s*${itemNumber}[.)]\\s`, "im")
      : null;

  return [...best.entries()]
    .map(([id, score]) => {
      const chunk = byId.get(id);
      if (!chunk) {
        return null;
      }
      let boosted = score;
      if (itemLinePattern?.test(chunk.text)) {
        boosted = Math.max(boosted, 0.92);
      }
      return { id, source: chunk.source, text: chunk.text, score: boosted };
    })
    .filter(Boolean)
    .sort((a, b) => (b!.score ?? 0) - (a!.score ?? 0))
    .slice(0, Math.max(topK, 8)) as RagMatch[];
}

async function searchRagLinearMultiQuery(
  chunks: RagChunk[],
  queries: string[],
  settings: AppSettings,
  threshold: number,
  topK: number,
): Promise<RagMatch[]> {
  const queryEmbeddings: Array<{
    embedding: number[];
    norm: number;
  }> = [];

  for (const searchQuery of queries) {
    const embedding = await embedQueryCached(searchQuery, settings);
    queryEmbeddings.push({
      embedding,
      norm: embeddingNorm(embedding),
    });
  }

  const chunkNorms = getRagChunkNorms();
  const bestById = new Map<string, RagMatch>();

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const chunkNorm =
      chunkNorms?.get(chunk.id) ?? embeddingNorm(chunk.embedding);
    let bestScore = 0;
    for (const { embedding, norm } of queryEmbeddings) {
      const score = cosineSimilarityWithNorms(
        embedding,
        norm,
        chunk.embedding,
        chunkNorm,
      );
      if (score > bestScore) {
        bestScore = score;
      }
    }
    if (bestScore > threshold) {
      bestById.set(chunk.id, {
        id: chunk.id,
        source: chunk.source,
        text: chunk.text,
        score: bestScore,
      });
    }
    if (index > 0 && index % RAG_LINEAR_BATCH === 0) {
      await yieldToMain();
    }
  }

  return [...bestById.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
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
