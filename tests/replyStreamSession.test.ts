import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import { defaultSettings } from "../src/settings/appSettings";
import type { ChatMessage } from "../src/types/chat";
import { createReplyStreamSession } from "../src/app/replyStreamSession";
import type { buildMessages } from "../src/character/promptBuilder";

const mocks = vi.hoisted(() => ({
  streamLlm: vi.fn(),
  blipVoiceManager: {
    stop: vi.fn(),
    beginStream: vi.fn(),
    feedStream: vi.fn(),
    endStreamAsync: vi.fn(),
  },
}));

vi.mock("../src/llm/llmClient", () => ({
  streamLlm: mocks.streamLlm,
}));

vi.mock("../src/character/blipVoiceManager", () => ({
  blipVoiceManager: mocks.blipVoiceManager,
}));

function createHarness() {
  let history: ChatMessage[] = [
    { role: "user", content: "ping" },
    { role: "assistant", content: "", emotion: "neutral" },
  ];
  const setHistory = vi.fn((update: SetStateAction<ChatMessage[]>) => {
    history =
      typeof update === "function"
        ? update(history)
        : update;
  });
  const streamedContentRef = { current: "" };
  const streamUiTimerRef = { current: null as number | null };
  const pendingStreamContentRef = { current: "" };
  const setStreamingContent = vi.fn();
  const setStreamingAssistantIndex = vi.fn();
  const setHasStreamTokens = vi.fn();
  const onStateChange = vi.fn();
  const onAmbientBubble = vi.fn();

  const controller = new AbortController();
  const session = createReplyStreamSession({
    assistantIndex: 1,
    controller,
    settings: {
      ...defaultSettings,
      voiceStyle: "off",
      blipSpeakReplies: false,
      blipSpeakInitiative: false,
    },
    getSettings: () => ({
      ...defaultSettings,
      voiceStyle: "off",
      blipSpeakReplies: false,
      blipSpeakInitiative: false,
    }),
    activeWindow: null,
    isOpen: true,
    proactive: false,
    proactiveWhileOpen: false,
    wantAmbientReveal: false,
    streamedContentRef,
    streamUiTimerRef,
    pendingStreamContentRef,
    setHasStreamTokens,
    setHistory,
    setStreamingContent,
    setStreamingAssistantIndex,
    onAmbientBubble,
    onStateChange,
    getReplyEmotion: () => "neutral",
    setReplyEmotion: vi.fn(),
  });

  return {
    get history() {
      return history;
    },
    controller,
    session,
    streamedContentRef,
    setHasStreamTokens,
    setHistory,
    setStreamingContent,
    setStreamingAssistantIndex,
    onStateChange,
  };
}

describe("createReplyStreamSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.clearAllMocks();
    mocks.blipVoiceManager.beginStream.mockReturnValue(false);
    mocks.blipVoiceManager.endStreamAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("streams visible text through the throttled UI channel", async () => {
    mocks.streamLlm.mockImplementation(
      async (_messages, _settings, onToken, onEmotion) => {
        onToken("visible draft");
        onEmotion("happy");
        return "visible final";
      },
    );
    const harness = createHarness();

    harness.session.restartAmbientStream();
    const reply = await harness.session.runStream(
      [] as ReturnType<typeof buildMessages>,
    );
    vi.advanceTimersByTime(100);

    expect(reply).toBe("visible final");
    expect(harness.streamedContentRef.current).toBe("visible draft");
    expect(harness.setStreamingAssistantIndex).toHaveBeenCalledWith(1);
    expect(harness.setStreamingContent).toHaveBeenLastCalledWith("visible draft");
    expect(harness.setHasStreamTokens).toHaveBeenCalledWith(true);
    expect(harness.onStateChange).toHaveBeenCalledWith("speaking");
    expect(harness.history[1]?.emotion).toBe("happy");
  });

  it("keeps hidden retry text out of visible history and streaming state", async () => {
    mocks.streamLlm.mockImplementation(
      async (_messages, _settings, onToken, onEmotion) => {
        onToken("hidden draft");
        onEmotion("happy");
        return "hidden final";
      },
    );
    const harness = createHarness();

    const reply = await harness.session.runStream(
      [] as ReturnType<typeof buildMessages>,
      { revealToUser: false },
    );
    vi.advanceTimersByTime(100);

    expect(reply).toBe("hidden final");
    expect(harness.streamedContentRef.current).toBe("hidden draft");
    expect(harness.history[1]?.content).toBe("");
    expect(harness.history[1]?.emotion).toBe("neutral");
    expect(harness.setStreamingContent).not.toHaveBeenCalled();
    expect(harness.setHasStreamTokens).not.toHaveBeenCalled();
    expect(harness.onStateChange).not.toHaveBeenCalledWith("speaking");
  });

  it("forwards cancellation to the provider and ignores late callbacks", async () => {
    let lateToken: ((value: string) => void) | undefined;
    let providerSignal: AbortSignal | undefined;
    mocks.streamLlm.mockImplementation(
      async (_messages, _settings, onToken, _onEmotion, signal) => {
        lateToken = onToken;
        providerSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
        return "never";
      },
    );
    const harness = createHarness();
    const pending = harness.session.runStream(
      [] as ReturnType<typeof buildMessages>,
    );
    await Promise.resolve();
    await Promise.resolve();

    harness.controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(providerSignal?.aborted).toBe(true);

    lateToken?.("ghost draft");
    expect(harness.streamedContentRef.current).toBe("");
    expect(harness.history[1]?.content).toBe("");
  });

  it("classifies proactive-while-open as initiative speech", () => {
    const getSettings = vi.fn(() => ({
      ...defaultSettings,
      voiceStyle: "blip" as const,
      blipSpeakInitiative: true,
      blipSpeakReplies: false,
    }));
    const session = createReplyStreamSession({
      assistantIndex: 1,
      controller: new AbortController(),
      settings: defaultSettings,
      getSettings,
      activeWindow: null,
      isOpen: true,
      proactive: true,
      proactiveWhileOpen: true,
      wantAmbientReveal: false,
      streamedContentRef: { current: "" },
      streamUiTimerRef: { current: null },
      pendingStreamContentRef: { current: "" },
      setHasStreamTokens: vi.fn(),
      setHistory: vi.fn(),
      setStreamingContent: vi.fn(),
      setStreamingAssistantIndex: vi.fn(),
      onStateChange: vi.fn(),
      getReplyEmotion: () => "neutral",
      setReplyEmotion: vi.fn(),
    });
    session.restartAmbientStream();

    const beginArgs = mocks.blipVoiceManager.beginStream.mock.calls.at(-1)?.[0];
    expect(beginArgs?.initiative).toBe(true);
    expect(beginArgs?.reply).toBe(false);
    expect(beginArgs?.getSettings).toBe(getSettings);
  });
});
