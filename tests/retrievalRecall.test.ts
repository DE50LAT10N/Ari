import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  mixedRecallScore,
  overlapScore,
  queryWordSet,
} from "../src/memory/memoryScoring";

type EvalCase = {
  query: string;
  documents: Array<{ id: string; text: string }>;
  expectContains: string[];
  minScore: number;
};

const evalPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../evals/retrieval-recall.json",
);
const payload = JSON.parse(fs.readFileSync(evalPath, "utf8")) as {
  cases: EvalCase[];
};

function offlineRecall(caseItem: EvalCase): {
  bestId: string;
  bestScore: number;
  bestText: string;
} {
  const words = queryWordSet(caseItem.query);
  let bestId = "";
  let bestText = "";
  let bestScore = 0;
  for (const document of caseItem.documents) {
    const lexical = overlapScore(document.text, words);
    const score = mixedRecallScore(lexical, 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = document.id;
      bestText = document.text;
    }
  }
  return { bestId, bestScore, bestText };
}

describe("retrieval recall eval (offline)", () => {
  for (const caseItem of payload.cases) {
    it(`recalls «${caseItem.query.slice(0, 40)}»`, () => {
      const result = offlineRecall(caseItem);
      expect(result.bestScore).toBeGreaterThanOrEqual(caseItem.minScore);
      for (const fragment of caseItem.expectContains) {
        expect(result.bestText.toLowerCase()).toContain(fragment.toLowerCase());
      }
    });
  }
});
