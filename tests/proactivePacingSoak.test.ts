import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatProactiveSoakReport,
  simulateProactiveSoak,
} from "../src/character/proactivePacingSoak";
import { resetProactiveStateForTests } from "../src/character/proactiveState";
import { defaultSettings } from "../src/settings/appSettings";

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

describe("proactive pacing soak", () => {
  beforeEach(() => {
    setupStorage();
    resetProactiveStateForTests();
  });

  it("emits multiple smalltalks in 10 minutes on active open chat", () => {
    const settings = {
      ...defaultSettings,
      initiativeLevel: "active" as const,
      proactiveSmalltalkIntervalMinutes: 10,
      advisorEnabled: true,
    };

    const result = simulateProactiveSoak({
      settings,
      durationMs: 10 * 60_000,
      tickMs: 30_000,
      activityAgoMs: 5 * 60_000,
      chatOpen: true,
      adviceUrgencyLevel: "none",
    });

    expect(result.smalltalkSent).toBeGreaterThanOrEqual(2);
    expect(result.tickCount).toBe(20);
  });

  it("logs suppress reasons when open chat blocks advice", () => {
    const settings = {
      ...defaultSettings,
      initiativeLevel: "active" as const,
      proactiveSmalltalkIntervalMinutes: 10,
      advisorEnabled: true,
    };

    const result = simulateProactiveSoak({
      settings,
      durationMs: 4 * 60_000,
      tickMs: 30_000,
      activityAgoMs: 150_000,
      chatOpen: true,
      adviceUrgencyLevel: "medium",
    });

    expect(result.suppressions.open_chat_advice_silence ?? 0).toBeGreaterThan(0);
    expect(result.events.some((event) => event.kind === "suppressed")).toBe(
      true,
    );
  });

  it("formats a readable soak report", () => {
    const settings = {
      ...defaultSettings,
      initiativeLevel: "active" as const,
      proactiveSmalltalkIntervalMinutes: 10,
    };
    const result = simulateProactiveSoak({
      settings,
      durationMs: 6 * 60_000,
      tickMs: 60_000,
      activityAgoMs: 5 * 60_000,
      chatOpen: true,
      adviceUrgencyLevel: "none",
    });
    const report = formatProactiveSoakReport(result);

    expect(report).toContain("Proactive soak");
    expect(report).toContain("Emitted:");
    expect(report).toContain("Timeline:");
  });
});
