import { describe, expect, it } from "vitest";
import { buildTrimmedPromptContext } from "../src/chat/contextTrim";
import { estimateMessagesTokens } from "../src/chat/contextBudget";
import { buildMessages } from "../src/character/promptBuilder";
import { defaultSettings } from "../src/settings/appSettings";
import type { ChatMessage } from "../src/types/chat";

describe("buildTrimmedPromptContext", () => {
  it("hard-truncates a single huge RAG fragment to the model context budget", () => {
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
    expect(result.runtimeContext.memory?.length ?? 0).toBeLessThanOrEqual(1);
    expect(result.runtimeContext.memory?.[0]?.text.length ?? 0).toBeLessThan(
      hugeRag.length,
    );
    expect(result.trimNotes.some((note) => note.includes("RAG"))).toBe(true);
    expect(
      estimateMessagesTokens(
        buildMessages(result.fittedHistory, result.runtimeContext),
      ),
    ).toBeLessThanOrEqual(2048 - 512 - 96);
  });

  it("degrades proactive evidence before violating the hard context budget", () => {
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
    expect(result.runtimeContext.compactRuntime).toBe(true);
    expect(result.trimNotes).toContain("включён компактный proactive prompt");
    expect(
      estimateMessagesTokens(
        buildMessages(result.fittedHistory, result.runtimeContext),
      ),
    ).toBeLessThanOrEqual(2048 - 512 - 96);
  });
});
