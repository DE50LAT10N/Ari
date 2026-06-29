import { describe, expect, it } from "vitest";
import { mmrRerank } from "../src/memory/rerank";

describe("mmrRerank", () => {
  it("prefers diverse candidates over near duplicates", () => {
    const query = [1, 0, 0];
    const candidates = [
      {
        id: "a",
        text: "alpha",
        score: 0.95,
        embedding: [0.99, 0.1, 0],
      },
      {
        id: "b",
        text: "beta",
        score: 0.9,
        embedding: [0.98, 0.12, 0],
      },
      {
        id: "c",
        text: "gamma",
        score: 0.7,
        embedding: [0, 1, 0],
      },
    ];

    const ranked = mmrRerank(query, candidates, { topK: 2, lambda: 0.3 });
    expect(ranked.map((item) => item.id)).toEqual(["a", "c"]);
  });
});
