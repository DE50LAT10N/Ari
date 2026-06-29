import { describe, expect, it } from "vitest";
import {
  buildIvfIndex,
  searchIvfIndex,
  searchVectorsLinear,
} from "../src/memory/ivfIndex";

function vec(values: number[]): { id: string; embedding: number[] } {
  return { id: values.join("-"), embedding: values };
}

describe("ivfIndex", () => {
  it("returns null index below build threshold", () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      vec([index, index % 2, 1]),
    );
    expect(buildIvfIndex(entries)).toBeNull();
  });

  it("finds nearest vectors in linear mode", () => {
    const vectors = [
      { id: "a", embedding: [1, 0, 0], norm: 1 },
      { id: "b", embedding: [0, 1, 0], norm: 1 },
    ];
    const scores = searchVectorsLinear([0.95, 0.1, 0], vectors, 0.2);
    expect(scores.has("a")).toBe(true);
    expect(scores.has("b")).toBe(false);
  });

  it("searches IVF buckets when index is built", () => {
    const entries = Array.from({ length: 520 }, (_, index) =>
      vec([
        Math.sin(index),
        Math.cos(index),
        index % 3 === 0 ? 1 : 0,
      ]),
    );
    const index = buildIvfIndex(entries, 8);
    expect(index).not.toBeNull();
    if (!index) return;
    const scores = searchIvfIndex([1, 0, 0], index, 0.1, 2);
    expect(scores.size).toBeGreaterThan(0);
  });
});
