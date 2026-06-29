import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyRetrievalRerank } from "../src/memory/retrievalRerank";
import { defaultSettings, type AppSettings } from "../src/settings/appSettings";
import type { UserMemoryFact } from "../src/memory/userMemory";

vi.mock("../src/llm/embeddingCache", () => ({
  embedQueryCached: vi.fn(() => Promise.reject(new Error("embeddings offline"))),
}));

function setupStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
}

function fact(id: string, text: string): UserMemoryFact {
  return {
    id,
    text,
    createdAt: 1,
    updatedAt: 1,
    source: "manual",
    importance: "useful",
    confidence: 1,
    lastSeenAt: 1,
  };
}

describe("retrieval rerank resilience", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("keeps memory facts when embedding rerank is unavailable", async () => {
    const settings: AppSettings = {
      ...defaultSettings,
      llmProvider: "ollama",
      rerankEnabled: true,
      llmRerankEnabled: false,
    };
    const facts = [
      fact("a", "User prefers quiet initiative."),
      fact("b", "User is working on a desktop companion."),
    ];

    const result = await applyRetrievalRerank({
      query: "desktop companion initiative",
      settings,
      ragMatches: [],
      facts,
      episodes: [],
    });

    expect(result.facts.map(({ id }) => id)).toEqual(["a", "b"]);
  });
});
