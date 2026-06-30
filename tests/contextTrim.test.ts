import { describe, expect, it } from "vitest";
import { buildTrimmedPromptContext } from "../src/chat/contextTrim";
import { defaultSettings } from "../src/settings/appSettings";
import type { ChatMessage } from "../src/types/chat";

describe("buildTrimmedPromptContext", () => {
  it("does not hang when a single RAG fragment exceeds the token budget", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Что написано в документе про проект?" },
    ];
    const hugeRag = "фрагмент ".repeat(4000);
    const started = performance.now();
    const result = buildTrimmedPromptContext(
      history,
      {
        memory: [{ source: "doc.pdf", text: hugeRag }],
      },
      {
        ...defaultSettings,
        contextTokens: 2048,
        maxTokens: 512,
      },
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.runtimeContext.memory).toEqual([]);
    expect(result.trimNotes.some((note) => note.includes("RAG"))).toBe(true);
  });

  it("preserves proactive eventDescription and signal summary under trim pressure", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "короткий вопрос" },
    ];
    const longEvent = "событие ".repeat(500);
    const longSummary = "сигнал ".repeat(200);
    const result = buildTrimmedPromptContext(
      history,
      {
        proactive: true,
        eventDescription: longEvent,
        proactiveSignalSummary: longSummary,
        memory: [{ source: "doc.pdf", text: "фрагмент ".repeat(4000) }],
        userFacts: ["факт ".repeat(50), "факт2 ".repeat(50), "факт3 ".repeat(50)],
      },
      {
        ...defaultSettings,
        contextTokens: 2048,
        maxTokens: 512,
      },
    );
    expect(result.runtimeContext.eventDescription).toBe(longEvent);
    expect(result.runtimeContext.proactiveSignalSummary).toBe(longSummary);
  });
});
