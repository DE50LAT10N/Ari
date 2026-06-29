import { describe, expect, it } from "vitest";
import {
  mixedRecallScore,
  normalizeLexicalRecall,
  recallWeightsFromSettings,
} from "../src/memory/memoryScoring";

describe("memoryScoring recall", () => {
  it("normalizes lexical overlap into 0..1", () => {
    expect(normalizeLexicalRecall(0)).toBe(0);
    expect(normalizeLexicalRecall(3)).toBe(1);
    expect(normalizeLexicalRecall(6)).toBe(1);
  });

  it("uses lexical-only score when semantic is absent", () => {
    expect(mixedRecallScore(2, 0)).toBeCloseTo(2 / 3, 4);
  });

  it("combines normalized lexical and semantic with weights", () => {
    const score = mixedRecallScore(3, 0.5, { lexical: 0.4, semantic: 0.6 });
    expect(score).toBeCloseTo(0.4 * 1 + 0.6 * 0.5, 4);
  });

  it("normalizes recall weights from settings", () => {
    const weights = recallWeightsFromSettings({
      recallLexicalWeight: 0.3,
      recallSemanticWeight: 0.3,
    });
    expect(weights.lexical).toBeCloseTo(0.5, 4);
    expect(weights.semantic).toBeCloseTo(0.5, 4);
  });
});
