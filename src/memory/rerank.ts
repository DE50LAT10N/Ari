import { cosineSimilarity } from "./memoryScoring";

export type RerankCandidate = {
  id: string;
  text: string;
  score: number;
  embedding?: number[];
};

export type MmrRerankOptions = {
  lambda?: number;
  topK?: number;
};

export function mmrRerank(
  queryEmbedding: number[],
  candidates: RerankCandidate[],
  options: MmrRerankOptions = {},
): RerankCandidate[] {
  const lambda = options.lambda ?? 0.7;
  const topK = options.topK ?? candidates.length;
  const pool = candidates
    .filter((candidate) => candidate.embedding?.length)
    .sort((left, right) => right.score - left.score);

  if (!pool.length || !queryEmbedding.length) {
    return candidates.slice(0, topK);
  }

  const selected: RerankCandidate[] = [];
  const remaining = [...pool];

  while (selected.length < topK && remaining.length > 0) {
    let bestIndex = 0;
    let bestMmr = -Infinity;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const relevance = cosineSimilarity(
        queryEmbedding,
        candidate.embedding ?? [],
      );
      let maxSimilarity = 0;
      for (const picked of selected) {
        const similarity = cosineSimilarity(
          candidate.embedding ?? [],
          picked.embedding ?? [],
        );
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }
      const mmr = lambda * relevance - (1 - lambda) * maxSimilarity;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIndex = index;
      }
    }

    selected.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }

  const selectedIds = new Set(selected.map((item) => item.id));
  const withoutEmbeddings = candidates.filter(
    (candidate) => !selectedIds.has(candidate.id),
  );
  return [...selected, ...withoutEmbeddings].slice(0, topK);
}

export function dedupeRetrievalTexts<T extends { text: string }>(
  items: T[],
  limit: number,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = item.text.trim().toLowerCase().slice(0, 160);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}
