import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import { blipVoiceManager } from "../src/character/blipVoiceManager";

vi.mock("../src/character/blipBank", () => ({
  ensureAudioReady: vi.fn().mockResolvedValue(undefined),
  playBlip: vi.fn().mockResolvedValue(undefined),
  preloadBlipBank: vi.fn().mockResolvedValue(undefined),
  stopAllBlips: vi.fn(),
}));

function setupBrowserGlobals(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => storage.clear(),
  });
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

describe("blipVoiceManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupBrowserGlobals();
    blipVoiceManager.stop();
  });

  afterEach(() => {
    blipVoiceManager.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not report speaking for reveal-only text without audible blip playback", async () => {
    const onSpeakingStart = vi.fn();
    const onSpeakingEnd = vi.fn();
    const onDisplayUpdate = vi.fn();
    const started = blipVoiceManager.beginStream({
      settings: { ...defaultSettings, voiceStyle: "off" },
      revealOnly: true,
      onDisplayUpdate,
      onSpeakingStart,
      onSpeakingEnd,
    });

    expect(started).toBe(true);
    blipVoiceManager.feedStream("silent reveal");
    blipVoiceManager.endStream("silent reveal");
    await vi.runAllTimersAsync();

    expect(onDisplayUpdate).toHaveBeenCalled();
    expect(blipVoiceManager.isSpeaking()).toBe(false);
    expect(onSpeakingStart).not.toHaveBeenCalled();
    expect(onSpeakingEnd).not.toHaveBeenCalled();
  });

  it("reports speaking only while audible blip playback is active", async () => {
    const onSpeakingStart = vi.fn();
    const onSpeakingEnd = vi.fn();
    const started = blipVoiceManager.beginStream({
      settings: { ...defaultSettings, voiceStyle: "blip" },
      force: true,
      onDisplayUpdate: vi.fn(),
      onSpeakingStart,
      onSpeakingEnd,
    });

    expect(started).toBe(true);
    blipVoiceManager.feedStream("hello");
    blipVoiceManager.endStream("hello");
    await vi.advanceTimersByTimeAsync(0);

    expect(blipVoiceManager.isSpeaking()).toBe(true);
    expect(onSpeakingStart).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();

    expect(blipVoiceManager.isSpeaking()).toBe(false);
    expect(onSpeakingEnd).toHaveBeenCalledTimes(1);
  });
});
