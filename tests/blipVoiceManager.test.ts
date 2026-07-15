import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import { blipVoiceManager } from "../src/character/blipVoiceManager";
import { playBlip } from "../src/character/blipBank";

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
    await vi.runAllTimersAsync();

    expect(blipVoiceManager.isSpeaking()).toBe(true);
    expect(onSpeakingStart).toHaveBeenCalledTimes(1);

    await blipVoiceManager.endStreamAsync("hello");
    await vi.runAllTimersAsync();

    expect(blipVoiceManager.isSpeaking()).toBe(false);
    expect(onSpeakingEnd).toHaveBeenCalledTimes(1);
  });

  it("uses live settings from getSettings during stream playback", async () => {
    const playBlipMock = vi.mocked(playBlip);
    playBlipMock.mockClear();
    let volume = 0.2;
    const started = blipVoiceManager.beginStream({
      settings: { ...defaultSettings, voiceStyle: "blip", blipVolume: volume },
      getSettings: () => ({
        ...defaultSettings,
        voiceStyle: "blip",
        blipVolume: volume,
        blipPitch: 1.1,
        blipSpeed: 1,
      }),
      reply: true,
      force: true,
      onDisplayUpdate: vi.fn(),
    });

    expect(started).toBe(true);
    volume = 0.9;
    blipVoiceManager.feedStream("hello");
    await vi.runAllTimersAsync();
    await blipVoiceManager.endStreamAsync("hello");
    await vi.runAllTimersAsync();

    const lastCall = playBlipMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.volume).toBeGreaterThan(0.5);
  });

  it("ends stream without speaking when no blips are played", async () => {
    const onSpeakingStart = vi.fn();
    const onSpeakingEnd = vi.fn();
    const started = blipVoiceManager.beginStream({
      settings: { ...defaultSettings, voiceStyle: "blip" },
      force: true,
      reply: true,
      onDisplayUpdate: vi.fn(),
      onSpeakingStart,
      onSpeakingEnd,
    });

    expect(started).toBe(true);
    await blipVoiceManager.endStreamAsync("   ");
    await vi.runAllTimersAsync();

    expect(blipVoiceManager.isSpeaking()).toBe(false);
    expect(onSpeakingStart).not.toHaveBeenCalled();
    expect(onSpeakingEnd).not.toHaveBeenCalled();
  });

  it("finishes speaking after endStream even when reveal lags behind tokens", async () => {
    const onSpeakingEnd = vi.fn();
    blipVoiceManager.beginStream({
      settings: { ...defaultSettings, voiceStyle: "blip" },
      force: true,
      reply: true,
      onDisplayUpdate: vi.fn(),
      onSpeakingEnd,
    });
    blipVoiceManager.feedStream("hello");
    await vi.advanceTimersByTimeAsync(48);
    const finishPromise = blipVoiceManager.endStreamAsync("hello world");
    await vi.runAllTimersAsync();
    await finishPromise;

    expect(blipVoiceManager.isSpeaking()).toBe(false);
    expect(onSpeakingEnd).toHaveBeenCalledTimes(1);
  });
});
