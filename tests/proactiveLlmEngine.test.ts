import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  collectProactiveSignalFacts,
  resetProactiveLlmCacheForTests,
  synthesizeProactiveBundle,
  validateProactiveReplyLlm,
} from "../src/character/proactiveLlmEngine";
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

describe("proactiveLlmEngine", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    resetProactiveLlmCacheForTests();
    vi.mocked(completeLlmJson).mockReset();
  });

  it("merges facts via LLM with adviceSteps, topicLinks and usefulness gate", async () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x at ChatPanel.tsx:42",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 10,
    });
    const input = {
      bundle,
      tone: "advice" as const,
      candidateTopics: ["ChatPanel.tsx", "ReferenceError: x"],
      recentUserMessage: "почему падает сборка?",
      sessionMinutes: 10,
      llmOnline: true,
    };
    const facts = collectProactiveSignalFacts(input);
    const clipFact = facts.find((fact) => fact.kind === "clipboard");
    const chatFact = facts.find((fact) => fact.kind === "chat");
    expect(clipFact).toBeTruthy();
    expect(chatFact).toBeTruthy();

    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: ["ошибка в буфере и вопрос про сборку"],
      mergedAnchor: "разбор падения сборки в ChatPanel.tsx",
      narrativeBrief:
        "ReferenceError в буфере отвечает на вопрос про сборку и указывает на ChatPanel.tsx.",
      primaryChainSummary:
        "ошибка в буфере отвечает на вопрос про сборку и сходится на ChatPanel.tsx",
      topicLinks: [
        {
          fromFactId: chatFact!.id,
          toFactId: clipFact!.id,
          relation: "answers_question",
          label: "вопрос про сборку связан с ошибкой в буфере",
          strength: 0.85,
        },
      ],
      initiativeMove: "clipboard_probe",
      groundFactIds: [clipFact!.id, chatFact!.id],
      practicalHook:
        "В буфере «ReferenceError: x at ChatPanel.tsx:42» — это текущая отладка?",
      adviceSteps: ["открыть ChatPanel.tsx:42", "сверить импорт модуля"],
      usefulnessScore: 0.82,
      shouldSend: true,
      overlapsBanned: false,
      linkConfidence: 0.85,
    });

    const result = await synthesizeProactiveBundle(defaultSettings, input);

    expect(result.source).toBe("llm");
    expect(result.adviceSteps?.length).toBeGreaterThan(0);
    expect(result.topicLinks?.length).toBeGreaterThan(0);
    expect(result.initiativeMove).toBe("clipboard_probe");
    expect(result.shouldSend).toBe(true);
    expect(result.usefulnessScore).toBeGreaterThan(0.45);
  });

  it("sets shouldSend false when usefulness is low or banned overlap", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "app.ts - Ari - Cursor",
      sessionMinutes: 5,
    });
    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: ["повтор старой темы"],
      mergedAnchor: "повтор",
      narrativeBrief: "повтор",
      usefulnessScore: 0.2,
      shouldSend: false,
      overlapsBanned: true,
      rejectReason: "пересечение с запретами",
    });

    const result = await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["повтор старой темы"],
      sessionMinutes: 5,
      llmOnline: true,
    });

    expect(result.shouldSend).toBe(false);
    expect(result.overlapsBanned).toBe(true);
  });

  it("uses fallback with playbook move and chain when LLM offline", async () => {
    recordClipboardSignal({
      clipKind: "code",
      snippet: "export function test() {}",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "link.ts - Ari - Cursor",
      sessionMinutes: 5,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 5,
    });
    expect(facts.length).toBeGreaterThan(0);

    const result = await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["link.ts"],
      sessionMinutes: 5,
      llmOnline: false,
    });

    expect(result.source).toBe("fallback");
    expect(result.initiativeMove).toBeTruthy();
    expect(result.primaryChainSummary).toBeTruthy();
    expect(completeLlmJson).not.toHaveBeenCalled();
  });

  it("fallback smalltalk check-in stays sendable with minimal context", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Spotify.exe",
      windowTitle: "Discover Weekly",
      sessionMinutes: 15,
    });
    const result = await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "smalltalk",
      candidateTopics: ["как настроение", "что слушаешь"],
      sessionMinutes: 15,
      llmOnline: false,
    });

    expect(result.source).toBe("fallback");
    expect(result.shouldSend).toBe(true);
    expect(result.linkedThemes.length).toBeGreaterThan(0);
  });

  it("accepts LLM advice bundle without topicLinks by filling graph edges", async () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "ReferenceError: x at ChatPanel.tsx:42",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 10,
    });
    const input = {
      bundle,
      tone: "advice" as const,
      candidateTopics: ["ChatPanel.tsx"],
      recentUserMessage: "почему падает сборка?",
      sessionMinutes: 10,
      llmOnline: true,
    };
    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: ["ошибка в буфере и сборка"],
      mergedAnchor: "ChatPanel.tsx",
      narrativeBrief:
        "ReferenceError в буфере связан с вопросом про сборку и ChatPanel.tsx.",
      practicalHook: "ReferenceError: x at ChatPanel.tsx:42 — это текущая отладка?",
      usefulnessScore: 0.8,
      shouldSend: true,
      overlapsBanned: false,
    });

    const result = await synthesizeProactiveBundle(defaultSettings, input);

    expect(result.source).toBe("llm");
    expect(result.shouldSend).toBe(true);
    expect(result.topicLinks?.length).toBeGreaterThan(0);
  });

  it("validateProactiveReplyLlm flags meta commentary", async () => {
    vi.mocked(completeLlmJson).mockResolvedValue({
      acceptable: false,
      reason: "мета про сюжет",
      issues: ["meta"],
    });

    const result = await validateProactiveReplyLlm(
      defaultSettings,
      {
        tone: "advice",
        linkedThemes: ["ошибка"],
        mergedAnchor: "debug",
        narrativeBrief: "ошибка в буфере",
        practicalHook: "npm run build",
        adviceSteps: ["npm run build"],
        usefulnessScore: 0.8,
        shouldSend: true,
        overlapsBanned: false,
        source: "llm",
      },
      "Ха, звучит как начало крутого сюжета!",
    );

    expect(result.acceptable).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
