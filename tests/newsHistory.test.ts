import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadChatHistory, saveChatHistory } from "../src/chat/chatHistory";

describe("news source history", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
  });

  it("persists one validated HTTPS source with the assistant message", () => {
    saveChatHistory([{
      role: "assistant",
      content: "По данным JPL, у миссии обновилось программное обеспечение.",
      sources: [{
        title: "Mission software update",
        publisher: "JPL News",
        url: "https://www.jpl.nasa.gov/news/software-update",
        publishedAt: Date.parse("2026-07-15T10:00:00Z"),
      }],
    }]);
    expect(loadChatHistory()[0].sources).toEqual([{
      title: "Mission software update",
      publisher: "JPL News",
      url: "https://www.jpl.nasa.gov/news/software-update",
      publishedAt: Date.parse("2026-07-15T10:00:00Z"),
    }]);
  });

  it("drops non-HTTPS source metadata", () => {
    saveChatHistory([{
      role: "assistant",
      content: "Новостная реплика.",
      sources: [{ title: "Unsafe", publisher: "Unknown", url: "http://example.com", publishedAt: Date.now() }],
    }]);
    expect(loadChatHistory()[0].sources).toBeUndefined();
  });
});
