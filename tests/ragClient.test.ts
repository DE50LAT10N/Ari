import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  getEmbeddingSource,
  resolveEmbeddingModel,
} from "../src/llm/embeddingConfig";
import {
  getLastRagSearchDiagnostics,
  searchRag,
} from "../src/rag/ragClient";
import { buildRagSearchPlan } from "../src/rag/ragQueryBuilder";

const mocks = vi.hoisted(() => ({
  loadRagChunks: vi.fn(),
  embedQueryCached: vi.fn(),
  getRagChunkNorms: vi.fn(),
  resolveIvfIndex: vi.fn(),
}));

vi.mock("../src/rag/ragStore", () => ({
  loadRagChunks: mocks.loadRagChunks,
  saveRagChunks: vi.fn(),
  getRagChunkNorms: mocks.getRagChunkNorms,
  invalidateRagChunksCache: vi.fn(),
}));

vi.mock("../src/llm/embeddingCache", () => ({
  embedQueryCached: mocks.embedQueryCached,
  clearEmbeddingQueryCache: vi.fn(),
}));

vi.mock("../src/memory/ivfStore", () => ({
  resolveIvfIndex: mocks.resolveIvfIndex,
  clearStoredIvfIndex: vi.fn(),
}));

vi.mock("../src/platform/logger", () => ({
  logError: vi.fn(),
}));

describe("embeddingConfig", () => {
  it("respects explicit gigachat embeddings when llm provider is ollama", () => {
    const settings = {
      ...defaultSettings,
      llmProvider: "ollama" as const,
      embeddingSource: "gigachat" as const,
    };
    expect(getEmbeddingSource(settings)).toBe("gigachat");
    expect(resolveEmbeddingModel(settings)).toBe(settings.gigaChatEmbeddingModel);
  });
});

describe("searchRag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRagChunkNorms.mockReturnValue(new Map());
    mocks.resolveIvfIndex.mockResolvedValue({ index: null, searchMode: "linear" });
  });

  it("surfaces embedding dimension mismatch instead of silent empty results", async () => {
    mocks.loadRagChunks.mockResolvedValue([
      {
        id: "chunk-1",
        source: "notes.md",
        text: "Старый индекс",
        embedding: [0.1, 0.2, 0.3],
        createdAt: 1,
      },
    ]);
    mocks.embedQueryCached.mockResolvedValue([0.4, 0.5, 0.6, 0.7]);

    const result = await searchRag("тест", {
      ...defaultSettings,
      ragEnabled: true,
      embeddingSource: "gigachat",
    });

    expect(result.matches).toEqual([]);
    expect(result.error).toMatch(/размерность/i);
    expect(getLastRagSearchDiagnostics()?.error).toMatch(/размерность/i);
  });

  it("returns matches from linear search when embeddings align", async () => {
    mocks.loadRagChunks.mockResolvedValue([
      {
        id: "chunk-1",
        source: "notes.md",
        text: "Держать генерацию в hook.",
        embedding: [1, 0, 0],
        createdAt: 1,
      },
      {
        id: "chunk-2",
        source: "other.md",
        text: "Нерелевантный текст.",
        embedding: [0, 1, 0],
        createdAt: 2,
      },
    ]);
    mocks.embedQueryCached.mockResolvedValue([0.99, 0.01, 0]);

    const result = await searchRag("hook generation", {
      ...defaultSettings,
      ragEnabled: true,
      ragScoreThreshold: 0.2,
      ragTopK: 2,
    });

    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.text).toContain("hook");
    expect(getLastRagSearchDiagnostics()?.matches).toBeGreaterThan(0);
  });

  it("finds numbered document questions via hybrid lexical search", async () => {
    mocks.loadRagChunks.mockResolvedValue([
      {
        id: "chunk-pp-4",
        source: "Вопросы ПП.pdf",
        text: "4. Распараллелить существующий алгоритм на несколько потоков.",
        embedding: [0, 1, 0],
        createdAt: 1,
      },
      {
        id: "chunk-other",
        source: "other.md",
        text: "Нерелевантный текст.",
        embedding: [1, 0, 0],
        createdAt: 2,
      },
    ]);
    mocks.embedQueryCached.mockResolvedValue([0.01, 0.99, 0]);

    const query =
      "Какой вопрос в документе Вопросы ПП под номером 4";
    const result = await searchRag(query, {
      ...defaultSettings,
      ragEnabled: true,
      ragScoreThreshold: 0.2,
      ragTopK: 4,
    }, {
      plan: buildRagSearchPlan(query),
    });

    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.text).toMatch(/распараллелить/i);
    expect(result.lexicalHits).toBeGreaterThan(0);
    expect(result.searchQueries?.length).toBeGreaterThan(1);
  });

  it("uses BM25 lexical channel to recover when semantic would mis-rank", async () => {
    mocks.loadRagChunks.mockResolvedValue([
      {
        id: "chunk-wrong",
        source: "Вопросы ПП.pdf",
        text: "24. Распараллеливание существующего алгоритма.",
        embedding: [0, 1, 0],
        createdAt: 1,
      },
      {
        id: "chunk-right",
        source: "Вопросы ПП.pdf",
        text: "4. Распараллелить существующий алгоритм на несколько потоков.",
        embedding: [0.98, 0.02, 0],
        createdAt: 2,
      },
    ]);
    // Pretend embeddings favor the wrong chunk for the cleaned query.
    mocks.embedQueryCached.mockResolvedValue([0, 1, 0]);

    const query = "Используй RAG вопрос в документе Вопросы ПП номер 4";
    const result = await searchRag(
      query,
      {
        ...defaultSettings,
        ragEnabled: true,
        ragScoreThreshold: 0.2,
        ragTopK: 4,
      },
      { plan: buildRagSearchPlan(query) },
    );

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.text).toMatch(/\b4[.)]/);
  });
});
