import { describe, expect, it } from "vitest";
import { estimateTextTokens } from "../src/chat/contextBudget";

describe("contextBudget", () => {
  it("estimates more tokens for cyrillic than ascii at same length", () => {
    const ascii = estimateTextTokens("hello world test message");
    const cyrillic = estimateTextTokens("привет мир тестовое сообщение");
    expect(cyrillic).toBeGreaterThan(ascii);
  });
});
