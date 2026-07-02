import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildInitiativeFeatures,
  getRecentIgnoredInitiativeCount,
  markInitiativeAcknowledged,
  markInitiativeSent,
  pruneExpiredPendingInitiatives,
  recordInitiativeOutcome,
  scoreInitiativeLocally,
} from "../src/character/initiativeScoring";
import { rememberProactiveTopic, resetProactiveStateForTests } from "../src/character/proactiveState";

const PENDING_KEY = "desktop-character.initiative-pending.v2";
const ADAPTIVE_KEY = "desktop-character.initiative-adaptive.v1";
const DAILY_KEY = "desktop-character.initiative-daily.v1";

function setupStorage(): Map<string, string> {
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
  return storage;
}

const sampleFeatures = buildInitiativeFeatures({
  risk: "low",
  value: "medium",
  scene: "idle",
  ignoredCount: 1,
  intent: "question",
});

describe("initiativeScoring", () => {
  beforeEach(() => {
    setupStorage();
    resetProactiveStateForTests();
  });

  it("tracks multiple unacknowledged initiatives", () => {
    markInitiativeSent();
    markInitiativeSent();
    expect(getRecentIgnoredInitiativeCount()).toBe(2);
    markInitiativeAcknowledged();
    expect(getRecentIgnoredInitiativeCount()).toBe(0);
  });

  it("prunes expired pending and records negative outcomes when adaptive", () => {
    const storage = setupStorage();
    const expiredAt = Date.now() - 16 * 60_000;
    storage.set(
      PENDING_KEY,
      JSON.stringify([{ at: expiredAt, features: sampleFeatures }]),
    );
    localStorage.removeItem(ADAPTIVE_KEY);

    pruneExpiredPendingInitiatives(true);

    expect(getRecentIgnoredInitiativeCount()).toBe(0);
    expect(localStorage.getItem(ADAPTIVE_KEY)).toBeTruthy();
  });

  it("records false for prior pending when sending a second initiative", () => {
    localStorage.removeItem(ADAPTIVE_KEY);
    markInitiativeSent(sampleFeatures, true);
    markInitiativeSent(sampleFeatures, true);
    expect(getRecentIgnoredInitiativeCount()).toBe(1);
    expect(localStorage.getItem(ADAPTIVE_KEY)).toBeTruthy();
  });

  it("allows adaptive scoring path", () => {
    const decision = scoreInitiativeLocally({
      description: "напоминание о сроке задачи",
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 5 * 60_000,
      adaptiveEnabled: true,
      intent: "question",
    });
    expect(typeof decision.allowed).toBe("boolean");
  });

  it("allows a planned check after the normal initiative interval", () => {
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: да",
      ].join("\n"),
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 20 * 60_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckFreshTopics: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.value).toBe("medium");
    expect(decision.reason).toMatch(/плановая|ценность/i);
  });

  it("honors a one minute planned initiative interval", () => {
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: да",
      ].join("\n"),
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 60_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 60_000,
      plannedCheckFreshTopics: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.value).toBe("medium");
    expect(decision.reason).toMatch(/плановая|ценность/i);
  });

  it("allows planned check even when prior initiatives were ignored", () => {
    markInitiativeSent();
    markInitiativeSent();
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: да",
      ].join("\n"),
      scene: "focus",
      chatClosedAgoMs: 10 * 60_000,
      userActivityAgoMs: 120_000,
      dailyCap: 7,
      riskTolerance: 1,
      plannedCheckMinSilenceMs: 60_000,
      plannedCheckFreshTopics: true,
    });

    expect(decision.allowed).toBe(true);
  });

  it("allows active planned check even when no fresh topics remain", () => {
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: нет",
      ].join("\n"),
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 120_000,
      dailyCap: 7,
      riskTolerance: 1,
      plannedCheckMinSilenceMs: 60_000,
      plannedCheckFreshTopics: false,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("плановая проверка после тишины");
  });

  it("allows concrete advice after short activity in active mode", () => {
    const decision = scoreInitiativeLocally({
      description:
        "Режим реплики: совет. Planner: docs_to_code_bridge — связать README.md с текущим шагом.",
      scene: "focus",
      chatClosedAgoMs: 10 * 60_000,
      userActivityAgoMs: 20_000,
      dailyCap: 99,
      riskTolerance: 1,
      plannedCheckMinSilenceMs: 120_000,
      practicalAdviceReady: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.value).toBe("high");
    expect(decision.reason).toBe("конкретный совет по текущему контексту");
  });

  it("allows concrete advice through one pending initiative in normal mode", () => {
    markInitiativeSent();

    const decision = scoreInitiativeLocally({
      description:
        "Режим реплики: совет. Planner: docs_to_code_bridge — связать README.md с текущим шагом.",
      scene: "focus",
      chatClosedAgoMs: 10 * 60_000,
      userActivityAgoMs: 45_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 120_000,
      practicalAdviceReady: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.value).toBe("high");
  });

  it("keeps concrete advice blocked after repeated unacknowledged initiatives", () => {
    markInitiativeSent();
    markInitiativeSent();
    markInitiativeSent();

    const decision = scoreInitiativeLocally({
      description:
        "Режим реплики: совет. Planner: docs_to_code_bridge — связать README.md с текущим шагом.",
      scene: "focus",
      chatClosedAgoMs: 10 * 60_000,
      userActivityAgoMs: 45_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 120_000,
      practicalAdviceReady: true,
    });

    expect(decision.allowed).toBe(false);
  });

  it("allows practical advice even when topic strongly overlaps recent initiatives", () => {
    rememberProactiveTopic(
      "desktop character activeWindow permissions typescript multifactor",
    );

    const decision = scoreInitiativeLocally({
      description: [
        "Смысловая цепочка: desktop character activeWindow permissions typescript multifactor context.",
        "Инициативный ход: ide_invite.",
        "Конкретный заход: проверь activeWindow permissions в typescript.",
        "Режим реплики: совет.",
      ].join("\n"),
      scene: "focus",
      chatClosedAgoMs: 10 * 60_000,
      userActivityAgoMs: 60_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 120_000,
      practicalAdviceReady: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("конкретный совет по текущему контексту");
  });

  it("blocks non-advice initiatives on strong topic overlap", () => {
    rememberProactiveTopic(
      "desktop character activeWindow permissions typescript multifactor",
    );

    const decision = scoreInitiativeLocally({
      description:
        "desktop character activeWindow permissions typescript multifactor initiative check",
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 5 * 60_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 120_000,
      practicalAdviceReady: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("тема слишком похожа на недавнюю инициативу");
  });

  it("allows engine-approved advice to bypass strong topic overlap", () => {
    rememberProactiveTopic(
      "desktop character activeWindow permissions typescript multifactor",
    );

    const decision = scoreInitiativeLocally({
      description:
        "desktop character activeWindow permissions typescript multifactor initiative check",
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 5 * 60_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 120_000,
      engineApproved: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).not.toBe("тема слишком похожа на недавнюю инициативу");
  });

  it("blocks planned check when no fresh topics remain at normal initiative level", () => {
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: нет",
      ].join("\n"),
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 120_000,
      dailyCap: 7,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 60_000,
      plannedCheckFreshTopics: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("нет свежих тем для инициативы");
  });

  it("keeps silent level from auto-starting planned checks", () => {
    const decision = scoreInitiativeLocally({
      description: "Плановая проверка инициативы после периода тишины.",
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 120_000,
      dailyCap: 99,
      riskTolerance: -1,
      plannedCheckMinSilenceMs: 60_000,
    });

    expect(decision.allowed).toBe(false);
  });

  it("does not treat recent-topic disclaimer as duplicate overlap", () => {
    const recent =
      "Плановая проверка: Tauri active window permissions activeWindow.ts";
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Возможные темы для живой реплики (выбери одну): как идёт desktop.",
        `Недавние темы инициативы, которые нельзя повторять: ${recent}.`,
      ].join("\n"),
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 120_000,
      dailyCap: 7,
      riskTolerance: 1,
      plannedCheckMinSilenceMs: 60_000,
      plannedCheckFreshTopics: true,
    });

    expect(decision.allowed).toBe(true);
  });

  it("allows planned check when context lists many topics but a fresh anchor exists", () => {
    rememberProactiveTopic(
      "что нашёл по «Нет, а ты перестала зацикливаться на Сбере?»",
    );
    const decision = scoreInitiativeLocally({
      description: [
        "Плановая проверка инициативы после периода тишины.",
        "Доступны свежие темы: да",
        "Возможные темы для живой реплики (выбери одну):",
        "- как идёт Ari Desktop Character",
        "- что нашёл по «YouTube»",
        "- что нашёл по «Нет, а ты перестала зацикливаться на Сбере?»",
        "- что нашёл по «Привет»",
        "Недавние темы инициативы, которые нельзя повторять: Сбер, зацикливаться.",
      ].join("\n"),
      scene: "idle",
      chatClosedAgoMs: 60 * 60_000,
      userActivityAgoMs: 120_000,
      dailyCap: 99,
      riskTolerance: 0,
      plannedCheckMinSilenceMs: 60_000,
      plannedCheckFreshTopics: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).not.toBe("тема слишком похожа на недавнюю инициативу");
  });

  it("updates adaptive weights without throwing", () => {
    localStorage.removeItem(ADAPTIVE_KEY);
    localStorage.removeItem(DAILY_KEY);
    localStorage.removeItem(PENDING_KEY);
    const features = buildInitiativeFeatures({
      risk: "low",
      value: "high",
      scene: "idle",
      ignoredCount: 0,
      intent: "question",
    });
    recordInitiativeOutcome(features, true);
    recordInitiativeOutcome(features, false);
    expect(localStorage.getItem(ADAPTIVE_KEY)).toBeTruthy();
  });
});
