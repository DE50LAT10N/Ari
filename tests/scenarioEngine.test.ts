import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markScenarioTriggered,
  resolveScenario,
} from "../src/character/scenarioEngine";

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
}

describe("scenarioEngine", () => {
  beforeEach(() => {
    setupStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not mark scenario triggered on resolve alone", () => {
    const outcome = resolveScenario("first_message_today", {
      scenario: "first_message_today",
      scene: "focus",
      hour: 13,
      idleSeconds: 0,
      chatOpen: false,
      characterState: "idle",
      ritual: "midday",
      ritualTone: "середина дня — короткий чек-ин",
    });
    expect(outcome.kind).toBe("initiative");

    const retry = resolveScenario("first_message_today", {
      scenario: "first_message_today",
      scene: "focus",
      hour: 13,
      idleSeconds: 0,
      chatOpen: false,
      characterState: "idle",
      ritual: "midday",
      ritualTone: "середина дня — короткий чек-ин",
    });
    expect(retry.kind).toBe("initiative");
  });

  it("blocks repeat after markScenarioTriggered", () => {
    resolveScenario("first_message_today", {
      scenario: "first_message_today",
      scene: "focus",
      hour: 13,
      idleSeconds: 0,
      chatOpen: false,
      characterState: "idle",
      ritual: "midday",
      ritualTone: "середина дня — короткий чек-ин",
    });
    markScenarioTriggered("first_message_today");

    const retry = resolveScenario("first_message_today", {
      scenario: "first_message_today",
      scene: "focus",
      hour: 13,
      idleSeconds: 0,
      chatOpen: false,
      characterState: "idle",
      ritual: "midday",
      ritualTone: "середина дня — короткий чек-ин",
    });
    expect(retry.kind).toBe("noop");
  });
});
