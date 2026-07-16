import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeConversationMemory,
  recordConversationMemoryExchange,
  resetConversationMemoryForTests,
  shouldPostprocessConversationMemory,
  shouldRetrieveLongTermMemory,
} from "../src/memory/conversationMemory";

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
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
}

describe("conversationMemory", () => {
  beforeEach(() => {
    setupStorage();
    resetConversationMemoryForTests();
  });

  it("does not retrieve or postprocess durable memory for tiny social replies", () => {
    expect(shouldRetrieveLongTermMemory("спасибо")).toBe(false);
    expect(shouldPostprocessConversationMemory("ага", "Угу.")).toBe(false);
  });

  it("retrieves and postprocesses when the user gives a durable memory signal", () => {
    const message = "Запомни: мне нравится, когда Ari отвечает коротко и с иронией.";

    expect(shouldRetrieveLongTermMemory(message)).toBe(true);
    expect(shouldPostprocessConversationMemory(message, "Записала.")).toBe(true);
  });

  it("retrieves memory for short continuation follow-ups", () => {
    expect(shouldRetrieveLongTermMemory("продолжи")).toBe(true);
    expect(shouldRetrieveLongTermMemory("а код?")).toBe(true);
    expect(shouldRetrieveLongTermMemory("сделай")).toBe(true);
    expect(shouldRetrieveLongTermMemory("дальше")).toBe(true);
  });

  it("keeps lightweight conversational continuity without LLM extraction", () => {
    recordConversationMemoryExchange({
      userMessage: "Запомни: я не люблю длинные финальные вопросы.",
      assistantReply: "Услышала.",
      emotion: "calm",
    });

    expect(describeConversationMemory()).toContain("tone/user preference");
    expect(describeConversationMemory()).toContain("длинные финальные вопросы");
  });
});
