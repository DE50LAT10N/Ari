import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  armProactiveGracePeriod,
  ensureProactiveClockStarted,
  getLastProactiveAttemptAt,
  invalidateProactiveStateCache,
} from "../src/character/proactiveState";
import {
  allowsGenericCompanionInitiative,
  prefersLocalCompanionLines,
  proactiveIntervalMs,
} from "../src/character/initiativeConfig";
import {
  isPlannedCheckDescription,
  shouldUseLlmInitiativeGate,
  scoreInitiativeLocally,
} from "../src/character/initiativeScoring";
import { defaultSettings } from "../src/settings/appSettings";
import {
  dailyInitiativeCap,
  initiativeRiskTolerance,
} from "../src/character/initiativeConfig";
import { classifyResponseMode } from "../src/character/responseModes";

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
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("proactive loop helpers", () => {
  beforeEach(() => {
    setupStorage();
    invalidateProactiveStateCache();
  });

  it("arms grace period so next check is immediate", () => {
    armProactiveGracePeriod(60_000);
    expect(Date.now() - getLastProactiveAttemptAt()).toBeGreaterThanOrEqual(
      59_000,
    );
  });

  it("starts proactive clock in the past on first run", () => {
    ensureProactiveClockStarted(120_000);
    expect(Date.now() - getLastProactiveAttemptAt()).toBeGreaterThanOrEqual(
      119_000,
    );
  });

  it("detects planned check descriptions", () => {
    expect(
      isPlannedCheckDescription(
        "Плановая проверка инициативы после периода тишины.",
      ),
    ).toBe(true);
    expect(isPlannedCheckDescription("случайный контекст")).toBe(false);
  });

  it("skips LLM gate for planned check-in", () => {
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: да",
      ].join("\n"),
      scene: "focus",
      chatClosedAgoMs: 300_000,
      userActivityAgoMs: 150_000,
      plannedCheckMinSilenceMs: 120_000,
      dailyCap: 7,
      riskTolerance: 1,
      plannedCheckFreshTopics: true,
    });
    expect(decision.allowed).toBe(true);
    expect(
      shouldUseLlmInitiativeGate(decision, { skipForPlannedCheckIn: true }),
    ).toBe(false);
  });

  it("allows planned check with short silence threshold", () => {
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: да",
      ].join("\n"),
      scene: "morning",
      chatClosedAgoMs: 300_000,
      userActivityAgoMs: 130_000,
      plannedCheckMinSilenceMs: 120_000,
      dailyCap: dailyInitiativeCap(defaultSettings),
      riskTolerance: initiativeRiskTolerance(defaultSettings),
      plannedCheckFreshTopics: true,
    });
    expect(decision.value).toBe("medium");
    expect(decision.allowed).toBe(true);
  });

  it("maps proactive initiative kind to response mode", () => {
    expect(
      classifyResponseMode({
        message: "",
        proactive: true,
        initiativeKind: "return_reaction",
      }),
    ).toBe("return_reaction");
    expect(
      classifyResponseMode({
        message: "",
        proactive: true,
        initiativeKind: "process_advice",
      }),
    ).toBe("technical_help");
    expect(
      classifyResponseMode({
        message: "",
        proactive: true,
      }),
    ).toBe("idle_initiative");
  });

  it("allows generic companion initiative after planned silence", () => {
    expect(allowsGenericCompanionInitiative(90_000, 60_000)).toBe(true);
    expect(allowsGenericCompanionInitiative(30_000, 60_000)).toBe(false);
  });

  it("prefers LLM companion lines when provider is online", () => {
    const settings = { ...defaultSettings, initiativeLevel: "active" as const };
    expect(prefersLocalCompanionLines(settings, 60_000)).toBe(false);
    expect(
      prefersLocalCompanionLines(
        { ...defaultSettings, initiativeLevel: "normal", proactiveIntervalMinutes: 1 },
        proactiveIntervalMs({
          ...defaultSettings,
          initiativeLevel: "normal",
          proactiveIntervalMinutes: 1,
        }),
      ),
    ).toBe(false);
    expect(
      prefersLocalCompanionLines(settings, 60_000, { practicalContext: true }),
    ).toBe(false);
  });

  it("falls back to local lines only when LLM is offline", () => {
    expect(
      prefersLocalCompanionLines(defaultSettings, 20 * 60_000, {
        llmOffline: true,
      }),
    ).toBe(true);
    expect(prefersLocalCompanionLines(defaultSettings, 20 * 60_000)).toBe(
      false,
    );
  });

  it("allows immersed companion check-in via companion silence gate", () => {
    expect(
      allowsGenericCompanionInitiative(45_000, 120_000, {
        immersedCompanion: true,
        companionSilenceMs: 13 * 60_000,
        companionSilenceMinMs: 12 * 60_000,
      }),
    ).toBe(true);
  });
});
