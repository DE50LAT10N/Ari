import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildInitiativeSignalBundle,
  buildProactiveInitiativeContext,
  buildProactiveInitiativePackage,
  formatInitiativeContextForPrompt,
} from "../src/character/initiativeContext";
import { PRACTICAL_INITIATIVE_RULE } from "../src/character/advisorEngine";
import { PROACTIVE_CHARACTER_RULE } from "../src/character/proactiveLiveliness";
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
      ["что нашёл по «Studio — Личный кабинет»", "как идёт ChatPanel.tsx"],
      {
        recentProactive: [],
        windowTitle: "Studio — Личный кабинет технологических продуктов Сбера",
        dominantFile: "ChatPanel.tsx",
      },
    );
    expect(anchor).toBe("как идёт ChatPanel.tsx");
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
        kind === "distraction_nudge" ||
        kind === "break_suggestion"
      ) {
        expect(pkg.eventDescription).toContain(PRACTICAL_INITIATIVE_RULE);
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
});
