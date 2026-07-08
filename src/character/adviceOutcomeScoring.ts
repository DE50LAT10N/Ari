import { clamp } from "../platform/mathUtils";
import type { AdviceOutcome } from "./adviceOutcome";

export type AdviceOutcomeWeightProfile = Record<AdviceOutcome, number>;

export type AdviceOutcomeScoringRecord = {
  outcome?: AdviceOutcome;
  confidence: number;
};

export type AdviceOutcomeScoreSummary = {
  sampleSize: number;
  positive: number;
  negative: number;
  score: number;
};

const RECENCY_DECAY = 0.35;
const MIN_CONFIDENCE_WEIGHT = 0.3;

export function summarizeWeightedAdviceOutcomes(
  records: AdviceOutcomeScoringRecord[],
  weights: AdviceOutcomeWeightProfile,
  limit = 8,
): AdviceOutcomeScoreSummary {
  const relevant = records.filter((entry) => entry.outcome).slice(0, limit);
  let weighted = 0;
  let totalWeight = 0;
  let positive = 0;
  let negative = 0;

  for (const [index, entry] of relevant.entries()) {
    if (!entry.outcome) continue;
    const value = weights[entry.outcome];
    const recency = 1 / (1 + index * RECENCY_DECAY);
    const confidence = clamp(entry.confidence, MIN_CONFIDENCE_WEIGHT, 1);
    const weight = recency * confidence;
    weighted += value * weight;
    totalWeight += weight;
    if (value > 0) positive += 1;
    if (value < 0) negative += 1;
  }

  return {
    sampleSize: relevant.length,
    positive,
    negative,
    score: totalWeight > 0 ? weighted / totalWeight : 0,
  };
}
