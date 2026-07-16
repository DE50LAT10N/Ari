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
    expect(result.fittedHistory.length).toBeGreaterThan(0);
    expect(
      result.fittedHistory.some((message) => message.role === "user"),
    ).toBe(true);
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
    expect(result.fittedHistory.length).toBeGreaterThan(0);
    expect(
      estimateMessagesTokens(
        buildMessages(result.fittedHistory, result.runtimeContext),
      ),
    ).toBeLessThanOrEqual(2048 - 512 - 96);
  });

  it("never wipes chat history under extreme runtime pressure", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Сначала была длинная задача про linked list." },
      { role: "assistant", content: "Ок, давай разберём." },
      {
        role: "user",
        content:
          "You are given two non-empty linked lists. Add the two numbers and return the sum as a linked list. Example 1: Input: l1 = [2,4,3]",
      },
    ];
    const result = buildTrimmedPromptContext(
      history,
      {
        ideMentorEvidence: "evidence ".repeat(5000),
        mentorTaskGoal: "goal ".repeat(500),
        projectPinnedContext: "pin ".repeat(500),
        memory: [{ source: "a.pdf", text: "rag ".repeat(3000) }],
        userFacts: Array.from({ length: 8 }, (_, i) => `факт${i} `.repeat(40)),
      },
      {
        ...defaultSettings,
        contextTokens: 2048,
        maxTokens: 512,
      },
    );

    expect(result.fittedHistory.length).toBeGreaterThan(0);
    expect(
      result.fittedHistory.some((message) => message.role === "user"),
    ).toBe(true);
    expect(
      result.trimNotes.some((note) => note.includes("история удалена")),
    ).toBe(false);
    const lastUser = [...result.fittedHistory]
      .reverse()
      .find((message) => message.role === "user");
    expect(lastUser?.content.toLowerCase()).toMatch(/linked list|add the two/);
  });
});
