import { describe, expect, it } from "vitest";
import { buildBm25Index, scoreBm25 } from "../src/rag/bm25";

describe("bm25", () => {
  it("prefers chunks that contain rare tokens and numbers", () => {
    const chunks = [
      {
        id: "a",
        text: "Общее описание системы. Введение. Дальше много воды.",
      },
      {
        id: "b",
        text: "Ошибка E0425 в Rust возникает, когда имя не найдено в области видимости.",
      },
      {
        id: "c",
        text: "Пункт 24. Распараллеливание существующего алгоритма.",
      },
    ];
    const index = buildBm25Index(chunks);
    const results = scoreBm25(index, "Rust E0425", { topK: 3 });
    expect(results[0]?.id).toBe("b");
  });

  it("supports mixed RU/EN queries with numbers", () => {
    const chunks = [
      { id: "x", text: "Release notes for version 1.2.0. Fixed audio." },
      { id: "y", text: "Версия 1.2.1: улучшен RAG и добавлен BM25." },
    ];
    const index = buildBm25Index(chunks);
    const results = scoreBm25(index, "1.2.1 BM25", { topK: 2 });
    expect(results[0]?.id).toBe("y");
  });
});

