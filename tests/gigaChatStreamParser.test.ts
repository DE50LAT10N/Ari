import { describe, expect, it, vi } from "vitest";
import {
  createGigaChatStreamParser,
  describeEmptyGigaChatStream,
} from "../src/llm/gigaChatStreamParser";

describe("gigaChatStreamParser", () => {
  it("parses v1 SSE content split across transport chunks", () => {
    const onContent = vi.fn();
    const parser = createGigaChatStreamParser({ onContent });

    parser.push('data: {"choices":[{"delta":{"content":"При"}}]}\n');
    parser.push('\ndata: {"choices":[{"delta":{"content":"вет"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    const summary = parser.finish();

    expect(summary.content).toBe("Привет");
    expect(summary.finishReason).toBe("stop");
    expect(summary.doneSeen).toBe(true);
    expect(summary.contentChunks).toBe(2);
    expect(onContent).toHaveBeenLastCalledWith("Привет");
  });

  it("reports blacklist instead of treating it as rate limiting", () => {
    const parser = createGigaChatStreamParser({ onContent: () => undefined });
    parser.push('data: {"choices":[{"delta":{"content":""},"finish_reason":"blacklist"}]}\n\ndata: [DONE]\n\n');
    const summary = parser.finish();

    expect(summary.content).toBe("");
    expect(describeEmptyGigaChatStream(summary)).toContain("blacklist");
  });

  it("surfaces malformed streams without exposing their contents", () => {
    const parser = createGigaChatStreamParser({ onContent: () => undefined });
    parser.push("data: {not-json}\n\n");
    const summary = parser.finish();

    expect(summary.malformedEvents).toBe(1);
    expect(describeEmptyGigaChatStream(summary)).toContain("не удалось разобрать");
  });
});
