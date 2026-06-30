import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildInitiativeSignalBundle,
  buildProactiveInitiativeContext,
  buildProactiveInitiativePackage,
  formatInitiativeContextForPrompt,
} from "../src/character/initiativeContext";
import { PRACTICAL_INITIATIVE_RULE } from "../src/character/advisorEngine";
import { PROACTIVE_CHARACTER_RULE, PROACTIVE_SMALLTALK_RULE } from "../src/character/proactiveLiveliness";
import { proactiveKindToResponseMode } from "../src/character/responseModes";
import {
  isProactiveSubjectOnCooldown,
  normalizeProactiveSubject,
  rememberProactiveSubject,
  resetProactiveStateForTests,
} from "../src/character/proactiveState";
import { pickPlannedInitiativeAnchor } from "../src/character/advisorEngine";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
} from "../src/memory/activitySignals";
import { scoreAdviceUrgency } from "../src/character/adviceUrgency";
import { invalidateTaskCache } from "../src/tasks/taskStore";

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

describe("initiativeContext", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateTaskCache();
    resetProactiveStateForTests();
  });

  it("normalizes window titles for cooldown keys", () => {
    const normalized = normalizeProactiveSubject(
      "Studio — Личный кабинет технологических продуктов Сбера",
    );
    expect(normalized).toContain("studio");
    expect(normalized).not.toContain("сбера");
  });

  it("blocks repeated window title via subject cooldown", () => {
    rememberProactiveSubject(
      "Studio — Личный кабинет технологических продуктов Сбера",
    );
    expect(
      isProactiveSubjectOnCooldown(
        "Studio — Личный кабинет технологических продуктов Сбера",
      ),
    ).toBe(true);
    const anchor = pickPlannedInitiativeAnchor(
      ["Studio — Личный кабинет", "ChatPanel.tsx"],
      {
        recentProactive: [],
        windowTitle: "Studio — Личный кабинет технологических продуктов Сбера",
        dominantFile: "ChatPanel.tsx",
      },
    );
    expect(anchor).toBe("ChatPanel.tsx");
  });

  it("includes clipboard and project signals in formatted context", () => {
    recordClipboardSignal({
      clipKind: "code",
      snippet: "function buildInitiativeSignalBundle() {}",
    });
    const bundle = buildInitiativeSignalBundle(
      { ...defaultSettings, advisorEnabled: true },
      {
        processName: "Code.exe",
        windowTitle: "initiativeContext.ts - desktop-character - Cursor",
        sessionMinutes: 12,
        windowMinutes: 12,
      },
    );
    const formatted = formatInitiativeContextForPrompt(bundle);
    expect(formatted).toMatch(/initiativeContext|Code\.exe|буфер/i);
    const context = buildProactiveInitiativeContext({
      kind: "check_in",
      bundle,
      banned: [],
      anchor: "как идёт initiativeContext.ts",
      conversationTopics: ["как идёт initiativeContext.ts"],
    });
    expect(context).toContain("Доступные сигналы");
    expect(context).toContain("Доступны свежие темы: да");
  });

  const bundleOpts = {
    processName: "Code.exe",
    windowTitle: "initiativeContext.ts - desktop-character - Cursor",
    sessionMinutes: 12,
    windowMinutes: 12,
  };

  it("builds unified packages with signals, practical rule, and liveliness", () => {
    recordClipboardSignal({
      clipKind: "code",
      snippet: "export function buildProactiveInitiativePackage() {}",
    });
    const settings = { ...defaultSettings, advisorEnabled: true };

    for (const kind of [
      "process_advice",
      "unfinished_thread",
      "memory_callback",
      "distraction_nudge",
      "quiet_presence",
    ] as const) {
      const pkg = buildProactiveInitiativePackage(settings, kind, {
        ...bundleOpts,
        advisorAngle: kind === "process_advice" ? "debug_help" : undefined,
        taskTitle: kind === "unfinished_thread" ? "Finish refactor" : undefined,
        memorySnippet:
          kind === "memory_callback"
            ? { text: "любит кофе утром", kind: "fact" as const }
            : undefined,
        distractionPlace:
          kind === "distraction_nudge" ? "YouTube — cute cats" : undefined,
        eventHint:
          kind === "quiet_presence"
            ? "Пользователь долго в развлечении — короткая реплика рядом."
            : undefined,
      });
      expect(pkg.eventDescription).toContain(PROACTIVE_CHARACTER_RULE);
      if (
        kind === "process_advice" ||
        kind === "distraction_nudge"
      ) {
        expect(pkg.eventDescription).toContain(PRACTICAL_INITIATIVE_RULE);
        expect(pkg.proactiveReplyTone).toBe("advice");
      }
      if (kind === "memory_callback") {
        expect(pkg.eventDescription).toContain(PROACTIVE_SMALLTALK_RULE);
        expect(pkg.proactiveReplyTone).toBe("smalltalk");
      }
      expect(pkg.eventDescription).toContain("Доступные сигналы");
      expect(pkg.softInitiativeAnchor).toBe(true);
      expect(pkg.bannedProactiveTopics).toEqual([]);
    }
  });

  it("rotates anchor away from banned proactive subjects", () => {
    rememberProactiveSubject("Finish refactor");
    const pkg = buildProactiveInitiativePackage(
      { ...defaultSettings, advisorEnabled: true },
      "unfinished_thread",
      {
        ...bundleOpts,
        taskTitle: "Finish refactor",
      },
    );
    expect(pkg.initiativeAnchor).toBeUndefined();
  });

  it("uses advice tone for check_in with practical anchor", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: boom",
    });
    const settings = { ...defaultSettings, advisorEnabled: true };
    const pkg = buildProactiveInitiativePackage(settings, "check_in", {
      ...bundleOpts,
      conversationTopics: ["следующий шаг отладки по ошибке из буфера"],
    });
    expect(pkg.proactiveReplyTone).toBe("advice");
    expect(pkg.eventDescription).toContain(PRACTICAL_INITIATIVE_RULE);
    expect(pkg.eventDescription).toContain("Режим реплики: совет");
  });

  it("uses smalltalk tone for check_in with social topic", () => {
    const settings = { ...defaultSettings, advisorEnabled: true };
    const pkg = buildProactiveInitiativePackage(settings, "check_in", {
      processName: "Spotify.exe",
      windowTitle: "Discover Weekly",
      sessionMinutes: 1,
      windowMinutes: 1,
      conversationTopics: ["как прошло «Deploy»"],
    });
    expect(pkg.proactiveReplyTone).toBe("smalltalk");
    expect(pkg.eventDescription).toContain(PROACTIVE_SMALLTALK_RULE);
    expect(pkg.eventDescription).not.toContain(PRACTICAL_INITIATIVE_RULE);
    expect(pkg.eventDescription).toContain("Режим реплики: смолток");
  });

  it("maps proactive kinds to response modes", () => {
    expect(proactiveKindToResponseMode("return_reaction")).toBe(
      "return_reaction",
    );
    expect(proactiveKindToResponseMode("unfinished_thread")).toBe("reminder");
    expect(proactiveKindToResponseMode("process_advice")).toBe(
      "technical_help",
    );
    expect(proactiveKindToResponseMode("check_in")).toBe("idle_initiative");
  });

  it("includes urgency reasons and rich context in advice package", () => {
    recordClipboardSignal({
      clipKind: "stacktrace",
      snippet: "TypeError: cannot read property",
    });
    const settings = { ...defaultSettings, advisorEnabled: true };
    const bundle = buildInitiativeSignalBundle(settings, bundleOpts);
    const urgency = scoreAdviceUrgency(bundle, settings, {
      sessionMinutes: 12,
      userIntervalMs: 20 * 60_000,
    });
    const pkg = buildProactiveInitiativePackage(settings, "process_advice", {
      ...bundleOpts,
      urgency,
      advisorAngle: "debug_help",
      recentUserMessage: "что за ошибка в буфере?",
      companionSilenceMs: 15 * 60_000,
    });
    expect(pkg.eventDescription).toContain("Почему сейчас:");
    expect(pkg.eventDescription).toContain("Расширенный контекст:");
    expect(urgency.reasons.some((reason) => pkg.eventDescription.includes(reason))).toBe(
      true,
    );
    expect(pkg.proactiveSignalSummary).toBeTruthy();
  });

  it("includes conversation topics in generic check_in package", () => {
    const settings = { ...defaultSettings, advisorEnabled: true };
    const pkg = buildProactiveInitiativePackage(settings, "check_in", {
      ...bundleOpts,
      conversationTopics: ["как идёт initiativeContext.ts", "свежий буфер кода"],
    });
    expect(pkg.eventDescription).toContain("как идёт initiativeContext.ts");
    expect(pkg.eventDescription).toContain("Возможные темы");
  });

  it("uses linked synthesis with primary chain and adviceSteps instead of topic menu", () => {
    const settings = { ...defaultSettings, advisorEnabled: true };
    const pkg = buildProactiveInitiativePackage(settings, "process_advice", {
      ...bundleOpts,
      linkSynthesis: {
        tone: "advice",
        linkedThemes: [
          "ошибка в буфере и вопрос про сборку сходятся на initiativeContext.ts",
        ],
        mergedAnchor: "разбор падения сборки",
        narrativeBrief:
          "Похоже, свежая ошибка связана с вопросом про сборку и текущим файлом.",
        primaryChainSummary:
          "ошибка в буфере отвечает на вопрос про сборку и сходится на initiativeContext.ts",
        topicLinks: [
          {
            fromFactId: "chat:last-user",
            toFactId: "clip:stacktrace",
            relation: "answers_question",
            label: "вопрос про сборку связан с ошибкой в буфере",
            strength: 0.85,
          },
        ],
        initiativeMove: "clipboard_probe",
        practicalHook: "проверь импорт в initiativeContext.ts",
        adviceSteps: [
          "открыть initiativeContext.ts",
          "сверить импорт на строке с ошибкой",
        ],
        usefulnessScore: 0.85,
        shouldSend: true,
        overlapsBanned: false,
        source: "llm",
      },
    });
    expect(pkg.eventDescription).toContain("Смысловая цепочка:");
    expect(pkg.eventDescription).toContain("Связи:");
    expect(pkg.eventDescription).toContain("Инициативный ход:");
    expect(pkg.eventDescription).toContain("Смысл момента:");
    expect(pkg.eventDescription).toContain("Конкретный заход:");
    expect(pkg.eventDescription).toContain("Конкретные шаги");
    expect(pkg.eventDescription).toContain("сверить импорт");
    expect(pkg.eventDescription).not.toContain("Возможные темы (выбери одну");
    expect(pkg.initiativeAnchor).toBe("разбор падения сборки");
    expect(pkg.proactiveSignalSummary).toContain("проверь импорт");
  });
});
