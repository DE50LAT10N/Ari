import { tokenizeText } from "../memory/memoryScoring";

export type Bm25Index = {
  postings: Map<string, Array<{ id: string; tf: number }>>;
  df: Map<string, number>;
  docLen: Map<string, number>;
  avgdl: number;
  N: number;
  dynamicStopwords: Set<string>;
};

export type BuildBm25IndexOptions = {
  dynamicStopwordDfRatio?: number;
};

export type ScoreBm25Options = {
  topK: number;
  filterIds?: Set<string>;
  k1?: number;
  b?: number;
};

function idf(N: number, df: number): number {
  // Robust BM25 IDF.
  return Math.log(1 + (N - df + 0.5) / (df + 0.5));
}

function tokenizeForBm25(text: string): string[] {
  // Keep 1-digit numbers (e.g. "4") which are important for document lookups,
  // but still drop 1-letter alphabetic tokens.
  const tokens = tokenizeText(text, 1);
  return tokens.filter((token) => token.length >= 2 || /^\d+$/u.test(token));
}

export function buildBm25Index(
  chunks: Array<{ id: string; text: string }>,
  options: BuildBm25IndexOptions = {},
): Bm25Index {
  const dynamicStopwordDfRatio = options.dynamicStopwordDfRatio ?? 0.65;
  const N = chunks.length;
  const postings = new Map<string, Array<{ id: string; tf: number }>>();
  const df = new Map<string, number>();
  const docLen = new Map<string, number>();

  let totalLen = 0;
  for (const chunk of chunks) {
    const tokens = tokenizeForBm25(chunk.text);
    const tfMap = new Map<string, number>();
    for (const token of tokens) {
      tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
    }
    docLen.set(chunk.id, tokens.length);
    totalLen += tokens.length;
    for (const [token, tf] of tfMap) {
      const list = postings.get(token);
      if (list) {
        list.push({ id: chunk.id, tf });
      } else {
        postings.set(token, [{ id: chunk.id, tf }]);
      }
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  const dynamicStopwords = new Set<string>();
  if (N > 0) {
    for (const [token, tokenDf] of df) {
      if (tokenDf / N > dynamicStopwordDfRatio) {
        dynamicStopwords.add(token);
        postings.delete(token);
      }
    }
    for (const token of dynamicStopwords) {
      df.delete(token);
    }
  }

  const avgdl = N > 0 ? totalLen / N : 0;
  return { postings, df, docLen, avgdl, N, dynamicStopwords };
}

export function normalizeBm25Score(raw: number): number {
  // Smoothly maps [0..inf) to [0..1).
  return raw <= 0 ? 0 : raw / (raw + 8);
}

export function scoreBm25(
  index: Bm25Index,
  query: string,
  options: ScoreBm25Options,
): Array<{ id: string; score: number; raw: number }> {
  const topK = Math.max(1, Math.floor(options.topK));
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const filterIds = options.filterIds;

  const tokens = tokenizeForBm25(query);
  if (!tokens.length || index.N === 0 || index.avgdl === 0) {
    return [];
  }

  const uniqueTokens = [...new Set(tokens)].filter(
    (token) => !index.dynamicStopwords.has(token),
  );
  if (!uniqueTokens.length) {
    return [];
  }

  const scores = new Map<string, { raw: number; score: number }>();
  for (const token of uniqueTokens) {
    const postings = index.postings.get(token);
    if (!postings?.length) {
      continue;
    }
    const tokenDf = index.df.get(token) ?? postings.length;
    const tokenIdf = idf(index.N, tokenDf);
    for (const entry of postings) {
      if (filterIds && !filterIds.has(entry.id)) {
        continue;
      }
      const len = index.docLen.get(entry.id) ?? index.avgdl;
      const denom = entry.tf + k1 * (1 - b + (b * len) / index.avgdl);
      const contribution = tokenIdf * ((entry.tf * (k1 + 1)) / denom);
      const existing = scores.get(entry.id);
      if (existing) {
        existing.raw += contribution;
      } else {
        scores.set(entry.id, { raw: contribution, score: 0 });
      }
    }
  }

  const items = [...scores.entries()].map(([id, value]) => ({
    id,
    raw: value.raw,
    score: normalizeBm25Score(value.raw),
  }));

  items.sort((a, bItem) => bItem.score - a.score);
  return items.slice(0, topK);
}

