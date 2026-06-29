import {
  cosineSimilarity,
  cosineSimilarityWithNorms,
  embeddingNorm,
} from "./memoryScoring";

export type IndexedVector = {
  id: string;
  embedding: number[];
  norm: number;
};

export type IvfBucket = {
  centroid: number[];
  centroidNorm: number;
  ids: string[];
};

export type IvfIndex = {
  buckets: IvfBucket[];
  byId: Map<string, IndexedVector>;
  dimension: number;
};

export const IVF_BUILD_THRESHOLD = 500;
export const IVF_BUCKET_COUNT = 32;
export const IVF_PROBE_COUNT = 4;
export const IVF_KMEANS_ITERATIONS = 8;

function pickInitialCentroids(vectors: IndexedVector[], k: number): number[][] {
  const centroids: number[][] = [];
  const step = Math.max(1, Math.floor(vectors.length / k));
  for (let index = 0; index < k && index * step < vectors.length; index += 1) {
    centroids.push([...vectors[index * step].embedding]);
  }
  while (centroids.length < k && vectors.length > 0) {
    centroids.push([...vectors[centroids.length % vectors.length].embedding]);
  }
  return centroids;
}

function averageVectors(vectors: number[][]): number[] {
  if (!vectors.length) {
    return [];
  }
  const dimension = vectors[0]?.length ?? 0;
  const sum = new Array<number>(dimension).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < dimension; index += 1) {
      sum[index] += vector[index] ?? 0;
    }
  }
  return sum.map((value) => value / vectors.length);
}

export function buildIvfIndex(
  entries: Array<{ id: string; embedding: number[] }>,
  bucketCount = IVF_BUCKET_COUNT,
): IvfIndex | null {
  if (entries.length < IVF_BUILD_THRESHOLD) {
    return null;
  }

  const byId = new Map<string, IndexedVector>();
  for (const entry of entries) {
    byId.set(entry.id, {
      id: entry.id,
      embedding: entry.embedding,
      norm: embeddingNorm(entry.embedding),
    });
  }

  const vectors = [...byId.values()];
  const k = Math.min(bucketCount, Math.max(4, Math.floor(Math.sqrt(vectors.length))));
  let centroids = pickInitialCentroids(vectors, k);

  for (let iteration = 0; iteration < IVF_KMEANS_ITERATIONS; iteration += 1) {
    const assignments: IndexedVector[][] = Array.from({ length: k }, () => []);
    for (const vector of vectors) {
      let bestBucket = 0;
      let bestScore = -Infinity;
      for (let bucketIndex = 0; bucketIndex < centroids.length; bucketIndex += 1) {
        const score = cosineSimilarity(vector.embedding, centroids[bucketIndex]);
        if (score > bestScore) {
          bestScore = score;
          bestBucket = bucketIndex;
        }
      }
      assignments[bestBucket].push(vector);
    }
    centroids = assignments.map((cluster, index) => {
      if (!cluster.length) {
        return centroids[index];
      }
      return averageVectors(cluster.map((item) => item.embedding));
    });
  }

  const buckets: IvfBucket[] = centroids.map((centroid) => ({
    centroid,
    centroidNorm: embeddingNorm(centroid),
    ids: [],
  }));

  for (const vector of vectors) {
    let bestBucket = 0;
    let bestScore = -Infinity;
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
      const bucket = buckets[bucketIndex];
      const score = cosineSimilarityWithNorms(
        vector.embedding,
        vector.norm,
        bucket.centroid,
        bucket.centroidNorm,
      );
      if (score > bestScore) {
        bestScore = score;
        bestBucket = bucketIndex;
      }
    }
    buckets[bestBucket].ids.push(vector.id);
  }

  return {
    buckets,
    byId,
    dimension: vectors[0]?.embedding.length ?? 0,
  };
}

export function searchIvfIndex(
  queryEmbedding: number[],
  index: IvfIndex,
  scoreThreshold: number,
  probeCount = IVF_PROBE_COUNT,
): Map<string, number> {
  const scores = new Map<string, number>();
  const queryNorm = embeddingNorm(queryEmbedding);
  const rankedBuckets = index.buckets
    .map((bucket, bucketIndex) => ({
      bucketIndex,
      score: cosineSimilarityWithNorms(
        queryEmbedding,
        queryNorm,
        bucket.centroid,
        bucket.centroidNorm,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(probeCount, index.buckets.length));

  const seen = new Set<string>();
  for (const { bucketIndex } of rankedBuckets) {
    for (const id of index.buckets[bucketIndex].ids) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const entry = index.byId.get(id);
      if (!entry) {
        continue;
      }
      const score = cosineSimilarityWithNorms(
        queryEmbedding,
        queryNorm,
        entry.embedding,
        entry.norm,
      );
      if (score > scoreThreshold) {
        scores.set(id, score);
      }
    }
  }
  return scores;
}

export function searchVectorsLinear(
  queryEmbedding: number[],
  entries: IndexedVector[],
  scoreThreshold: number,
): Map<string, number> {
  const scores = new Map<string, number>();
  const queryNorm = embeddingNorm(queryEmbedding);
  for (const entry of entries) {
    const score = cosineSimilarityWithNorms(
      queryEmbedding,
      queryNorm,
      entry.embedding,
      entry.norm,
    );
    if (score > scoreThreshold) {
      scores.set(entry.id, score);
    }
  }
  return scores;
}
