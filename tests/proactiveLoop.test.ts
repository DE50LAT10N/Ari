import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  armProactiveGracePeriod,
  clearProactiveFailureBackoff,
  ensureProactiveClockStarted,
  getLastAdviceAttemptAt,
  getLastSmalltalkAttemptAt,
  getProactiveFailureBackoff,
  invalidateProactiveStateCache,
  registerProactiveFailure,
} from "../src/character/proactiveState";
import {
  allowsGenericCompanionInitiative,
  proactiveAdviceIntervalMs,
  proactiveSmalltalkIntervalMs,
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
    armProactiveGracePeriod(60_000, 5 * 60_000);
    expect(Date.now() - getLastAdviceAttemptAt()).toBeGreaterThanOrEqual(
      59_000,
    );
    expect(Date.now() - getLastSmalltalkAttemptAt()).toBeGreaterThanOrEqual(
      5 * 60_000 - 1_000,
    );
  });

  it("starts proactive clock in the past on first run", () => {
    ensureProactiveClockStarted(120_000, 6 * 60_000);
    expect(Date.now() - getLastAdviceAttemptAt()).toBeGreaterThanOrEqual(
      119_000,
    );
    expect(Date.now() - getLastSmalltalkAttemptAt()).toBeGreaterThanOrEqual(
      6 * 60_000 - 1_000,
    );
  });

  it("backs off proactive LLM retries after generation failures", () => {
    const first = registerProactiveFailure("timeout", 1_000);
    expect(first.failures).toBe(1);
    expect(first.until).toBe(301_000);
    expect(getProactiveFailureBackoff(2_000)?.reason).toBe("timeout");

    const second = registerProactiveFailure("still down", 2_000);
    expect(second.failures).toBe(2);
    expect(second.until).toBe(902_000);
    expect(getProactiveFailureBackoff(903_000)).toBeNull();
  });

  it("clears proactive failure backoff after recovery", () => {
    registerProactiveFailure("network", 1_000);
    expect(getProactiveFailureBackoff(2_000)).not.toBeNull();

    clearProactiveFailureBackoff();
    expect(getProactiveFailureBackoff(2_000)).toBeNull();
  });

  it("scales advice and smalltalk intervals independently", () => {
    const settings = {
      ...defaultSettings,
      initiativeLevel: "active" as const,
      proactiveSmalltalkIntervalMinutes: 5,
      proactiveAdviceIntervalMinutes: 20,
    };
    expect(proactiveSmalltalkIntervalMs(settings)).toBe(195_000);
    expect(proactiveAdviceIntervalMs(settings)).toBe(780_000);
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
