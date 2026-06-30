import type { AppSettings } from "../settings/appSettings";
import { embedQueryCached } from "../llm/embeddingCache";
import { isEmbeddingSourceConfigured } from "../llm/embeddingConfig";
import type { RagMatch } from "../rag/ragClient";
import { loadRagChunks } from "../rag/ragStore";
import type { MemoryEpisode } from "./episodicMemory";
import { llmRerankCandidates } from "./llmRerank";
import { mmrRerank, type RerankCandidate } from "./rerank";
import { getMemoryEmbeddingsByIds } from "./memorySemanticIndex";
import {
  recordRetrievalPass,
  type RetrievalSearchMode,
} from "./retrievalTelemetry";
import { shouldLlmRerank } from "./shouldLlmRerank";
import type { UserMemoryFact } from "./userMemory";

export type RetrievalBatchResult<T> = {
  items: T[];
  mmrApplied: boolean;
  llmRerankApplied: boolean;
};

async function rerankRagMatches(
  query: string,
  matches: RagMatch[],
  settings: AppSettings,
): Promise<RetrievalBatchResult<RagMatch>> {
  if (!settings.rerankEnabled || !matches.length) {
    return { items: matches, mmrApplied: false, llmRerankApplied: false };
  }
  if (!isEmbeddingSourceConfigured(settings)) {
    return { items: matches, mmrApplied: false, llmRerankApplied: false };
  }

  try {
    const queryEmbedding = await embedQueryCached(query, settings);
    const chunks = await loadRagChunks();
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk.embedding]));

    const candidates: RerankCandidate[] = matches.map((match, index) => ({
      id: match.id ?? `rag-${index}`,
      text: match.text,
      score: match.score,
      embedding: match.id ? byId.get(match.id) : chunks.find((c) => c.text === match.text)?.embedding,
    }));

    let ranked = mmrRerank(queryEmbedding, candidates, {
      topK: settings.ragTopK,
    });
    const mmrApplied = ranked.length > 0;

    let llmRerankApplied = false;
    if (shouldLlmRerank(query, candidates, settings)) {
      ranked = await llmRerankCandidates(query, ranked, settings, settings.ragTopK);
      llmRerankApplied = true;
    }

    const rankedTexts = new Set(ranked.map((item) => item.text));
    const items = matches
      .filter((match) => rankedTexts.has(match.text))
      .sort(
        (left, right) =>
          ranked.findIndex((item) => item.text === right.text) -
          ranked.findIndex((item) => item.text === left.text),
      );

    return { items, mmrApplied, llmRerankApplied };
  } catch {
    return { items: matches, mmrApplied: false, llmRerankApplied: false };
  }
}

async function rerankMemoryFacts(
  query: string,
  facts: UserMemoryFact[],
  settings: AppSettings,
  limit: number,
): Promise<RetrievalBatchResult<UserMemoryFact>> {
  if (!settings.rerankEnabled || facts.length <= 1) {
    return { items: facts, mmrApplied: false, llmRerankApplied: false };
  }
  if (!isEmbeddingSourceConfigured(settings)) {
    return { items: facts, mmrApplied: false, llmRerankApplied: false };
  }

  try {
    const queryEmbedding = await embedQueryCached(query, settings);
    const embeddings = await getMemoryEmbeddingsByIds(facts.map((fact) => fact.id));
    const candidates: RerankCandidate[] = facts.map((fact) => ({
      id: fact.id,
      text: fact.text,
      score: 1,
      embedding: embeddings.get(fact.id),
    }));
    const ranked = mmrRerank(queryEmbedding, candidates, { topK: limit });
    const order = new Map(ranked.map((item, index) => [item.id, index]));
    const items = [...facts].sort(
      (left, right) => (order.get(left.id) ?? 999) - (order.get(right.id) ?? 999),
    );
    return { items, mmrApplied: true, llmRerankApplied: false };
  } catch {
    return { items: facts, mmrApplied: false, llmRerankApplied: false };
  }
}

async function rerankEpisodes(
  query: string,
  episodes: MemoryEpisode[],
  settings: AppSettings,
  limit: number,
): Promise<RetrievalBatchResult<MemoryEpisode>> {
  if (!settings.rerankEnabled || episodes.length <= 1) {
    return { items: episodes, mmrApplied: false, llmRerankApplied: false };
  }
  if (!isEmbeddingSourceConfigured(settings)) {
    return { items: episodes, mmrApplied: false, llmRerankApplied: false };
  }

  try {
    const queryEmbedding = await embedQueryCached(query, settings);
    const embeddings = await getMemoryEmbeddingsByIds(
      episodes.map((episode) => episode.id),
    );
    const candidates: RerankCandidate[] = episodes.map((episode) => ({
      id: episode.id,
      text: `${episode.title} ${episode.text}`,
      score: 1,
      embedding: embeddings.get(episode.id),
    }));
    const ranked = mmrRerank(queryEmbedding, candidates, { topK: limit });
    const order = new Map(ranked.map((item, index) => [item.id, index]));
    const items = [...episodes].sort(
      (left, right) => (order.get(left.id) ?? 999) - (order.get(right.id) ?? 999),
    );
    return { items, mmrApplied: true, llmRerankApplied: false };
  } catch {
    return { items: episodes, mmrApplied: false, llmRerankApplied: false };
  }
}

export async function applyRetrievalRerank({
  query,
  settings,
  ragMatches,
  facts,
  episodes,
  searchMode = "none",
}: {
  query: string;
  settings: AppSettings;
  ragMatches: RagMatch[];
  facts: UserMemoryFact[];
  episodes: MemoryEpisode[];
  searchMode?: RetrievalSearchMode;
}): Promise<{
  rag: RagMatch[];
  facts: UserMemoryFact[];
  episodes: MemoryEpisode[];
}> {
  if (!ragMatches.length && !facts.length && !episodes.length) {
    return { rag: [], facts: [], episodes: [] };
  }
  if (!settings.rerankEnabled) {
    return { rag: ragMatches, facts, episodes };
  }

  const started = performance.now();
  const ragResult = await rerankRagMatches(query, ragMatches, settings);
  const factsResult = await rerankMemoryFacts(query, facts, settings, 6);
  const episodesResult = await rerankEpisodes(query, episodes, settings, 6);

  recordRetrievalPass({
    query: query.slice(0, 120),
    ragIn: ragMatches.length,
    ragOut: ragResult.items.length,
    factsIn: facts.length,
    factsOut: factsResult.items.length,
    episodesIn: episodes.length,
    episodesOut: episodesResult.items.length,
    searchMode,
    mmrApplied:
      ragResult.mmrApplied || factsResult.mmrApplied || episodesResult.mmrApplied,
    llmRerankApplied: ragResult.llmRerankApplied,
    ms: Math.round(performance.now() - started),
  });

  return {
    rag: ragResult.items,
    facts: factsResult.items,
    episodes: episodesResult.items,
  };
}

// Backward-compatible named exports
export { rerankRagMatches, rerankMemoryFacts, rerankEpisodes };
