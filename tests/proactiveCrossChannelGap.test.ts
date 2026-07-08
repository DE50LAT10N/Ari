import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canEmitAdviceNow,
  canEmitSmalltalkNow,
  markAdviceAttemptAt,
  markSmalltalkAttemptAt,
  openChatAdviceSilenceMs,
  proactiveCrossChannelGapMs,
  shouldSuppressOpenChatAdvice,
} from "../src/character/proactiveState";

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

describe("proactive cross-channel gap", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("blocks smalltalk shortly after advice", () => {
    const now = 1_000_000;
    const settings = { initiativeLevel: "normal" as const };
    const gap = proactiveCrossChannelGapMs(settings);
    markAdviceAttemptAt(now);
    expect(canEmitSmalltalkNow(settings, now + 60_000)).toBe(false);
    expect(canEmitSmalltalkNow(settings, now + gap)).toBe(true);
  });

  it("uses shorter cross-channel gap on active initiative", () => {
    const now = 3_000_000;
    const active = { initiativeLevel: "active" as const };
    markAdviceAttemptAt(now);
    expect(canEmitSmalltalkNow(active, now + 60_000)).toBe(false);
    expect(canEmitSmalltalkNow(active, now + 90_000)).toBe(true);
  });

  it("blocks advice shortly after smalltalk", () => {
    const now = 2_000_000;
    const settings = { initiativeLevel: "normal" as const };
    const gap = proactiveCrossChannelGapMs(settings);
    markSmalltalkAttemptAt(now);
    expect(canEmitAdviceNow(settings, now + 90_000)).toBe(false);
    expect(canEmitAdviceNow(settings, now + gap)).toBe(true);
  });
});

describe("open chat advice suppression", () => {
  it("suppresses advice in open chat with recent activity unless urgency is high", () => {
    const normal = { initiativeLevel: "normal" as const };
    expect(
      shouldSuppressOpenChatAdvice({
        chatOpen: true,
        activityAgoMs: 60_000,
        urgencyLevel: "medium",
        settings: normal,
      }),
    ).toBe(true);
    expect(
      shouldSuppressOpenChatAdvice({
        chatOpen: true,
        activityAgoMs: openChatAdviceSilenceMs(normal),
        urgencyLevel: "medium",
        settings: normal,
      }),
    ).toBe(false);
    expect(
      shouldSuppressOpenChatAdvice({
        chatOpen: true,
        activityAgoMs: 60_000,
        urgencyLevel: "high",
      }),
    ).toBe(false);
    expect(
      shouldSuppressOpenChatAdvice({
        chatOpen: false,
        activityAgoMs: 60_000,
        urgencyLevel: "medium",
      }),
    ).toBe(false);
  });

  it("uses shorter open-chat advice silence on active initiative", () => {
    const active = { initiativeLevel: "active" as const };
    expect(openChatAdviceSilenceMs(active)).toBe(3 * 60_000);
    expect(
      shouldSuppressOpenChatAdvice({
        chatOpen: true,
        activityAgoMs: 4 * 60_000,
        urgencyLevel: "medium",
        settings: active,
      }),
    ).toBe(false);
  });
});
