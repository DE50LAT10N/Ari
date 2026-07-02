import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordQueryTopic,
} from "../src/memory/activitySignals";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import {
  buildAdviceFallbackBundle,
  buildClarifyingProbeBundle,
  buildFileClarifyingQuestion,
  collectProactiveSignalFacts,
  isSingleFactorGenericAdvice,
  isThinContextGenericAdvice,
  localReplyQualityCheck,
  resetProactiveLlmCacheForTests,
  getLastProactiveLlmBundle,
  getLastProactiveSynthesisReject,
  synthesizeProactiveBundle,
  tryAdviceFallbackChain,
  validateProactiveReplyLlm,
} from "../src/character/proactiveLlmEngine";
import { recordWorkingEvent } from "../src/memory/workingMemory";
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

  it("includes real code excerpt in synthesis prompt when provided", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - desktop-character - Cursor",
      sessionMinutes: 10,
    });

    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: [],
      mergedAnchor: "code",
      narrativeBrief: "Сделай X, потому что Y и Z.",
      primaryChainSummary: "code -> fix",
      practicalHook: "Проверь условие в функции.",
      adviceSteps: ["Шаг 1", "Шаг 2"],
      usefulnessScore: 0.9,
      shouldSend: true,
      overlapsBanned: false,
      groundFactIds: [],
      topicLinks: [],
      initiativeMove: "concrete_step",
      linkConfidence: 0.8,
    } as any);

    await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "advice",
      llmOnline: true,
      codeExcerpts: [
        {
          file: "ChatPanel.tsx",
          text: "export function foo() { return 1; }",
        },
      ],
    });

    const calls = vi.mocked(completeLlmJson).mock.calls;
    const userContent = (calls[0]?.[0] as any)?.find((m: any) => m.role === "user")
      ?.content as string;
    expect(userContent).toContain("Реальный код из файла ChatPanel.tsx");
    expect(userContent).toContain("export function foo()");
  });

  it("falls back to grounded advice when synthesis is low usefulness or overlaps banned", async () => {
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

    expect(result.shouldSend).toBe(true);
    expect(result.usefulnessScore).toBeGreaterThan(0.45);
    expect(result.practicalHook).toBeTruthy();
  });

  it("uses a single synthesis call for GigaChat advice and falls back on overlapsBanned", async () => {
    const gigaSettings = {
      ...defaultSettings,
      llmProvider: "gigachat" as const,
    };
    const bundle = buildInitiativeSignalBundle(gigaSettings, {
      processName: "Cursor.exe",
      windowTitle: "ADVISOR_SIMULATION_REPORT.md - Ari - Cursor",
      sessionMinutes: 8,
    });
    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: ["ADVISOR_SIMULATION_REPORT.md"],
      mergedAnchor: "ADVISOR_SIMULATION_REPORT.md",
      narrativeBrief: "повтор темы",
      usefulnessScore: 0.1,
      shouldSend: false,
      overlapsBanned: true,
      rejectReason: "пересечение с запретами",
    });

    const result = await synthesizeProactiveBundle(gigaSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["ADVISOR_SIMULATION_REPORT.md"],
      sessionMinutes: 8,
      llmOnline: true,
      urgency: {
        level: "medium",
        score: 5,
        reasons: ["активный режим"],
        effectiveIntervalMs: 60_000,
      },
    });

    expect(completeLlmJson).toHaveBeenCalledTimes(1);
    expect(result.shouldSend).toBe(true);
    expect(result.usefulnessScore).toBeGreaterThan(0.45);
  });

  it("returns clarifying probe when synthesis score is zero and fallback chain fails", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "CHANGELOG.md - Ari - Cursor",
      sessionMinutes: 6,
    });
    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: ["CHANGELOG.md"],
      mergedAnchor: "CHANGELOG.md",
      narrativeBrief: "повтор",
      usefulnessScore: 0,
      shouldSend: false,
      overlapsBanned: false,
      rejectReason: "llm synthesis rejected",
    });

    const result = await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["CHANGELOG.md"],
      sessionMinutes: 6,
      llmOnline: true,
    });

    expect(result.shouldSend).toBe(true);
    expect(result.selectedAdviceCandidate?.kind).toBe("clarifying_probe");
    expect(result.usefulnessScore).toBeGreaterThan(0);
  });

  it("returns rejected LLM bundle instead of fallback when LLM is offline", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ambientThoughts.ts - Ari - Cursor",
      sessionMinutes: 5,
    });

    const result = await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "smalltalk",
      candidateTopics: ["ambientThoughts.ts"],
      sessionMinutes: 5,
      llmOnline: false,
    });

    expect(result.source).toBe("rejected");
    expect(result.shouldSend).toBe(false);
    expect(result.rejectReason).toBe("llm offline");
    expect(completeLlmJson).not.toHaveBeenCalled();
    expect(getLastProactiveLlmBundle()).toBeNull();
    expect(getLastProactiveSynthesisReject()?.rejectReason).toBe("llm offline");
  });

  it("falls back to planner advice when synthesis fails", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "README.md - desktop-character - Cursor",
      sessionMinutes: 8,
    });
    vi.mocked(completeLlmJson).mockRejectedValue(new Error("bad json"));

    const result = await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["README.md"],
      sessionMinutes: 8,
      llmOnline: true,
      adviceCandidate: {
        id: "docs-to-code-bridge",
        kind: "docs_to_code_bridge",
        evidenceIds: ["file:README.md"],
        actionText:
          "Свяжи README.md с текущим шагом: предложи проверить раздел установки.",
        expectedUtility: 0.74,
        interruptionCost: 0.25,
        confidence: 0.7,
        reason: "есть текущий файл и рабочий контекст",
        score: 1.2,
      },
    });

    expect(result.shouldSend).toBe(true);
    expect(result.practicalHook).toContain("README.md");
    expect(result.selectedAdviceCandidate?.kind).toBe("docs_to_code_bridge");
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

  it("retries synthesis when advice bundle repeats a banned archetype", async () => {
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
    vi.mocked(completeLlmJson)
      .mockResolvedValueOnce({
        tone: "advice",
        linkedThemes: ["повтор refocus"],
        mergedAnchor: "Cursor Agents",
        narrativeBrief:
          "Предлагаю выделить 10 минут на Cursor Agents: один файл, одна проверка, один результат.",
        practicalHook:
          "Попробуй выделить 10 минут на Cursor Agents: погрузись в один файл и реши одну задачу целиком.",
        usefulnessScore: 0.8,
        shouldSend: true,
        overlapsBanned: false,
      })
      .mockResolvedValueOnce({
        tone: "advice",
        linkedThemes: ["ошибка в буфере"],
        mergedAnchor: "ChatPanel.tsx",
        narrativeBrief:
          "ReferenceError в буфере отвечает на вопрос про сборку и указывает на ChatPanel.tsx.",
        practicalHook:
          "ReferenceError: x at ChatPanel.tsx:42 — начни с этой строки и проверь импорт.",
        usefulnessScore: 0.85,
        shouldSend: true,
        overlapsBanned: false,
      });

    const result = await synthesizeProactiveBundle(defaultSettings, input);

    expect(completeLlmJson).toHaveBeenCalledTimes(2);
    expect(result.practicalHook).toMatch(/ReferenceError|ChatPanel/i);
  });

  it("collects up to three clipboard facts", () => {
    const now = Date.now();
    recordClipboardSignal({
      clipKind: "text",
      snippet: "first clip snippet",
      at: now - 2_000,
    });
    recordClipboardSignal({
      clipKind: "code",
      snippet: "export function second() {}",
      at: now - 1_000,
    });
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: third at file.ts:1",
      at: now,
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      now,
      processName: "Cursor.exe",
      windowTitle: "file.ts - Ari - Cursor",
      sessionMinutes: 4,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 4,
    });
    const clips = facts.filter((fact) => fact.kind === "clipboard");
    expect(clips.length).toBe(3);
    expect(clips.some((fact) => fact.id.includes(":0"))).toBe(true);
  });

  it("collects reference facts from RAG snippets for substantive advice", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 8,
      ragSnippets: [
        "TS2345: narrow nullable value with an if guard before passing it to a function.",
      ],
    });

    const reference = facts.find((fact) => fact.kind === "reference");
    expect(reference?.detail).toMatch(/TS2345|nullable/i);
  });

  it("drops stale chat and query facts when IDE has a live file anchor", () => {
    recordQueryTopic({
      topic: "Подготовка к экзамену",
      source: "browser",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - desktop-character - Cursor",
      sessionMinutes: 8,
    });

    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      recentUserMessage: "заверши цель Подготовка к экзамену",
      sessionMinutes: 8,
    });

    expect(facts.some((fact) => fact.kind === "chat")).toBe(false);
    expect(facts.some((fact) => /экзамен/i.test(fact.detail))).toBe(false);
    expect(facts.some((fact) => /ChatPanel\.tsx/i.test(fact.detail))).toBe(true);
  });

  it("allows advice without a trailing question for concrete_step", async () => {
    vi.mocked(completeLlmJson).mockResolvedValue({
      acceptable: true,
      reason: "ok",
      issues: [],
    });

    const result = await validateProactiveReplyLlm(
      defaultSettings,
      {
        tone: "advice",
        linkedThemes: ["ChatPanel.tsx"],
        mergedAnchor: "ChatPanel.tsx",
        narrativeBrief: "работа в файле",
        practicalHook: "проверь импорт в начале файла",
        usefulnessScore: 0.8,
        shouldSend: true,
        overlapsBanned: false,
        source: "llm",
        initiativeMove: "concrete_step",
        groundFactIds: ["file:ChatPanel.tsx"],
      },
      "Хм. Сначала проверь импорт в начале ChatPanel.tsx — там чаще всего ломается.",
      [
        {
          id: "file:ChatPanel.tsx",
          kind: "file",
          label: "Файл в IDE",
          detail: "ChatPanel.tsx",
        },
      ],
    );

    expect(result.acceptable).toBe(true);
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

  it("includes grouped context and multi-factor advice rules in synthesis prompt", async () => {
    recordWorkingEvent({
      kind: "focus_update",
      topic: "дописать advice pipeline",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 8,
    });
    vi.mocked(completeLlmJson).mockResolvedValue({
      tone: "advice",
      linkedThemes: ["файл и фокус"],
      mergedAnchor: "ChatPanel.tsx",
      narrativeBrief:
        "Сделай X в ChatPanel.tsx, потому что focus update и сессия требуют закрыть advice pipeline.",
      primaryChainSummary:
        "файл ChatPanel.tsx + focus update определяют следующий шаг по advice pipeline",
      practicalHook: "проверь блок synthesizeProactiveBundle в ChatPanel.tsx",
      adviceSteps: ["открыть ChatPanel.tsx", "сверить fallback chain"],
      usefulnessScore: 0.82,
      shouldSend: true,
      overlapsBanned: false,
    });

    await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["ChatPanel.tsx"],
      sessionMinutes: 8,
      llmOnline: true,
    });

    const messages = vi.mocked(completeLlmJson).mock.calls[0]?.[0];
    expect(messages?.[0]?.content).toMatch(/минимум два фактора/i);
    expect(messages?.[1]?.content).toMatch(/Сгруппированный контекст/);
  });

  it("uses substantive clipboard fallback before clarifying when probe facts can answer", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: Cannot read properties of undefined",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ChatPanel.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 6,
    });
    const clarifying = buildClarifyingProbeBundle(
      { bundle, tone: "advice", sessionMinutes: 6 },
      facts,
      "llm synthesis rejected",
    );
    const chained = tryAdviceFallbackChain(
      { bundle, tone: "advice", sessionMinutes: 6 },
      facts,
      "llm synthesis rejected",
    );

    expect(clarifying?.rejectReason).toContain("clarifying probe");
    expect(clarifying?.initiativeMove).toBe("clipboard_probe");
    expect(chained?.rejectReason).toContain("fallback");
    expect(chained?.initiativeMove).toBe("concrete_step");
    expect(chained?.selectedAdviceCandidate?.kind).toBe("debug_next_step");
    expect(chained?.practicalHook).toMatch(/TypeError|буфер/i);
  });

  it("uses clipboard semantic anchors in fallback advice", () => {
    recordClipboardSignal({
      clipKind: "text",
      snippet: "Gates{Quiet? Offline? Busy?}\nInput{User message} --> Cmd{Chat command?}",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "ARCHITECTURE.md - Ari - Cursor",
      sessionMinutes: 8,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 8,
    });
    const chained = tryAdviceFallbackChain(
      { bundle, tone: "advice", sessionMinutes: 8 },
      facts,
      "llm synthesis rejected",
    );

    expect(chained?.selectedAdviceCandidate?.kind).toBe("debug_next_step");
    expect(chained?.practicalHook).toMatch(/Gates|Input|Cmd|узлы|связи/i);
    expect(chained?.practicalHook).not.toMatch(/перерыв|скопируй|уточни/i);
  });

  it("flags single-factor generic advice and accepts multi-factor replies", () => {
    const genericBundle = {
      tone: "advice" as const,
      linkedThemes: ["CHANGELOG.md"],
      mergedAnchor: "CHANGELOG.md",
      narrativeBrief: "шаг от файла",
      usefulnessScore: 0.62,
      shouldSend: true,
      overlapsBanned: false,
      source: "llm" as const,
      rejectReason: "fallback after llm synthesis rejected",
      initiativeMove: "concrete_step" as const,
    };
    const facts = [
      {
        id: "file:CHANGELOG.md",
        kind: "file" as const,
        label: "Файл в IDE",
        detail: "CHANGELOG.md",
      },
      {
        id: "wm:1",
        kind: "wm" as const,
        label: "focus_update",
        detail: "дописать advice pipeline",
      },
    ];

    expect(
      isSingleFactorGenericAdvice(
        "Сделай один следующий шаг от факта: CHANGELOG.md",
        facts,
        genericBundle,
      ),
    ).toBe(true);
    expect(
      localReplyQualityCheck(
        genericBundle,
        "Сделай один следующий шаг от факта: CHANGELOG.md",
        facts,
      )?.issues,
    ).toContain("single-factor generic");
    expect(
      isSingleFactorGenericAdvice(
        "Сделай правку в CHANGELOG.md, потому что focus update и файл вместе показывают, что advice pipeline ещё не закрыт.",
        facts,
        genericBundle,
      ),
    ).toBe(false);
  });

  it("detects thin-context generic advice with only passive file signal", () => {
    const bundle = {
      tone: "advice" as const,
      linkedThemes: ["CHANGELOG.md"],
      mergedAnchor: "CHANGELOG.md",
      narrativeBrief: "проверь файл",
      usefulnessScore: 0.62,
      shouldSend: true,
      overlapsBanned: false,
      source: "llm" as const,
      initiativeMove: "ide_invite" as const,
    };
    const facts = [
      {
        id: "file:CHANGELOG.md",
        kind: "file" as const,
        label: "Файл в IDE",
        detail: "CHANGELOG.md",
      },
    ];

    expect(
      isThinContextGenericAdvice(
        "А давай проверим CHANGELOG.md ещё раз? Мало ли что упустили!",
        facts,
        bundle,
      ),
    ).toBe(true);
    expect(
      localReplyQualityCheck(
        bundle,
        "Загляни ещё раз в CHANGELOG.md — вдруг там какая мелкая ошибка?",
        facts,
      )?.issues,
    ).toContain("thin-context generic");
    expect(
      isThinContextGenericAdvice(
        "Посмотри, нет ли в комментариях к твоему коду в ML.md каких-нибудь важных примечаний.",
        facts.map((fact) =>
          fact.kind === "file" ? { ...fact, detail: "ML.md" } : fact,
        ),
        { ...bundle, mergedAnchor: "ML.md", linkedThemes: ["ML.md"] },
      ),
    ).toBe(true);
  });

  it("routes thin context fallback to clarifying probe even with planner candidate", () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "CHANGELOG.md - Ari - Cursor",
      sessionMinutes: 4,
    });
    const facts = collectProactiveSignalFacts({
      bundle,
      tone: "advice",
      sessionMinutes: 4,
    });
    const chained = tryAdviceFallbackChain(
      {
        bundle,
        tone: "advice",
        sessionMinutes: 4,
        adviceCandidate: {
          id: "planner-1",
          kind: "refocus",
          evidenceIds: ["file:CHANGELOG.md"],
          actionText: "Сделай один следующий шаг от факта: CHANGELOG.md",
          expectedUtility: 0.7,
          interruptionCost: 0.1,
          confidence: 0.7,
          reason: "фокус на файле",
          score: 0.7,
        },
      },
      facts,
      "llm synthesis rejected",
    );

    expect(chained?.selectedAdviceCandidate?.kind).toBe("clarifying_probe");
    expect(chained?.practicalHook).toMatch(/\?/);
  });

  it("varies file clarifying questions by filename", () => {
    const a = buildFileClarifyingQuestion("CHANGELOG.md");
    const b = buildFileClarifyingQuestion("README.md");
    expect(a).toContain("CHANGELOG.md");
    expect(b).toContain("README.md");
    expect(a).not.toBe(b);
  });

  it("keeps last actionable bundle when a later synthesis is rejected", async () => {
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      processName: "Cursor.exe",
      windowTitle: "main.tsx - Ari - Cursor",
      sessionMinutes: 6,
    });
    vi.mocked(completeLlmJson).mockResolvedValueOnce({
      tone: "advice",
      linkedThemes: ["main.tsx"],
      mergedAnchor: "main.tsx",
      narrativeBrief: "уточнение по main.tsx",
      practicalHook: "Что сейчас делаешь с main.tsx — правишь логику или сверяешь поведение?",
      usefulnessScore: 0.58,
      shouldSend: true,
      overlapsBanned: false,
    });
    await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "advice",
      candidateTopics: ["main.tsx"],
      sessionMinutes: 6,
      llmOnline: true,
    });
    expect(getLastProactiveLlmBundle()?.shouldSend).toBe(true);
    expect(getLastProactiveLlmBundle()?.usefulnessScore).toBeGreaterThan(0.45);

    vi.mocked(completeLlmJson).mockResolvedValueOnce({
      tone: "smalltalk",
      linkedThemes: ["повтор"],
      mergedAnchor: "повтор",
      narrativeBrief: "повтор",
      usefulnessScore: 0,
      shouldSend: false,
      overlapsBanned: true,
      rejectReason: "пересечение с запретами",
    });
    await synthesizeProactiveBundle(defaultSettings, {
      bundle,
      tone: "smalltalk",
      candidateTopics: ["повтор"],
      sessionMinutes: 6,
      llmOnline: true,
    });

    expect(getLastProactiveLlmBundle()?.shouldSend).toBe(true);
    expect(getLastProactiveLlmBundle()?.usefulnessScore).toBeGreaterThan(0.45);
    expect(getLastProactiveSynthesisReject()?.tone).toBe("smalltalk");
    expect(getLastProactiveSynthesisReject()?.source).toBe("rejected");
  });
});
