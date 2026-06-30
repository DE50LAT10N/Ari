import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  collectProactiveSignalFacts,
  resetProactiveLinkCacheForTests,
  shouldRunLinkSynthesis,
  synthesizeProactiveLinks,
} from "../src/character/proactiveLinkSynthesizer";
import { completeLlmJson } from "../src/llm/llmClient";

vi.mock("../src/llm/llmClient", () => ({
  completeLlmJson: vi.fn(),
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
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("proactiveLinkSynthesizer", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    resetProactiveLinkCacheForTests();
    vi.mocked(completeLlmJson).mockReset();
  });

  it("collects distinct fact kinds from bundle and chat", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: boom",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 12,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      recentUserMessage: "почему падает сборка?",
      sessionMinutes: 12,
    });
    expect(facts.some((fact) => fact.kind === "file")).toBe(true);
    expect(facts.some((fact) => fact.kind === "clipboard")).toBe(true);
    expect(facts.some((fact) => fact.kind === "chat")).toBe(true);
    expect(shouldRunLinkSynthesis(facts, [])).toBe(true);
  });

  it("skips LLM when offline uses fallback", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Spotify.exe",
      windowTitle: "Discover Weekly",
      sessionMinutes: 0,
      windowMinutes: 0,
    });
    const synthesis = await synthesizeProactiveLinks(defaultSettings, {
      bundle,
      tone: "smalltalk",
      candidateTopics: [],
      sessionMinutes: 0,
      windowMinutes: 0,
      llmOnline: false,
    });
    expect(synthesis.source).toBe("heuristic");
    expect(completeLlmJson).not.toHaveBeenCalled();
  });

  it("merges topics via LLM when multiple signals exist", async () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x is not defined at ChatPanel.tsx:42",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 10,
    });
    const input = {
      bundle,
      tone: "advice" as const,
      candidateTopics: [
        "следующий шаг отладки по ошибке из буфера",
        "как идёт ChatPanel.tsx",
      ],
      recentUserMessage: "почему падает сборка?",
      sessionMinutes: 10,
      llmOnline: true,
    };
    const facts = collectProactiveSignalFacts(input);
    const clipFact = facts.find((fact) => fact.kind === "clipboard");
    const chatFact = facts.find((fact) => fact.kind === "chat");
    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: [
        "ошибка в буфере и вопрос про сборку сходятся на ChatPanel.tsx",
      ],
      mergedAnchor: "разбор падения сборки в ChatPanel.tsx",
      narrativeBrief:
        "ReferenceError в буфере связан с вопросом про сборку и ChatPanel.tsx.",
      primaryChainSummary:
        "ошибка в буфере отвечает на вопрос про сборку на ChatPanel.tsx",
      topicLinks: clipFact && chatFact
        ? [
            {
              fromFactId: chatFact.id,
              toFactId: clipFact.id,
              relation: "answers_question",
              label: "вопрос про сборку связан с ошибкой в буфере",
              strength: 0.85,
            },
          ]
        : [],
      initiativeMove: "clipboard_probe",
      groundFactIds: [clipFact?.id, chatFact?.id].filter(Boolean),
      practicalHook:
        "В буфере «ReferenceError: x is not defined at ChatPanel.tsx:42» — это текущая отладка?",
      usefulnessScore: 0.8,
      shouldSend: true,
      overlapsBanned: false,
    });

    const synthesis = await synthesizeProactiveLinks(defaultSettings, input);

    expect(synthesis.source).toBe("llm");
    expect(synthesis.linkedThemes[0]).toMatch(/ChatPanel|буфер|сборк/i);
    expect(synthesis.practicalHook).toMatch(/ChatPanel|42/i);
    expect(completeLlmJson).toHaveBeenCalledTimes(1);

    const cached = await synthesizeProactiveLinks(defaultSettings, {
      ...input,
    });
    expect(cached.source).toBe("llm");
    expect(completeLlmJson).toHaveBeenCalledTimes(1);
  });

  it("falls back to heuristic when LLM response is invalid", async () => {
    recordClipboardSignal({
      clipKind: "code",
      snippet: "export function test() {}",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "link.ts - Ari - Cursor",
      sessionMinutes: 5,
    });
    vi.mocked(completeLlmJson).mockResolvedValue({
      linkedThemes: [],
      mergedAnchor: "",
      narrativeBrief: "",
    });

    const synthesis = await synthesizeProactiveLinks(defaultSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["как идёт link.ts", "подсказка по фрагменту кода из буфера"],
      recentUserMessage: "помоги с функцией",
      sessionMinutes: 5,
    });

    expect(synthesis.source).toBe("heuristic");
    expect(synthesis.mergedAnchor).toBeTruthy();
  });
});
