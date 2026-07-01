import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ambientThoughtCooldownMs,
  generateAmbientThought,
  getRecentAmbientThoughts,
  localAmbientThoughtCooldownMs,
  pickLocalAmbientThought,
  rememberAmbientThought,
  resetAmbientThoughtsForTests,
  shouldAttemptAmbientThought,
  shouldAttemptLocalAmbientThought,
  validateAmbientThought,
  validateAmbientThoughtDetailed,
} from "../src/character/ambientThoughts";
import { completeLlmJson } from "../src/llm/llmClient";
import { defaultSettings } from "../src/settings/appSettings";

vi.mock("../src/llm/llmClient", () => ({
  completeLlmJson: vi.fn(),
}));

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

const baseInput = {
  scene: "focus" as const,
  attention: "observing" as const,
  mood: {
    warmth: 0.45,
    energy: 0.58,
    irritation: 0.05,
    updatedAt: Date.now(),
  },
  activeProcess: "Cursor.exe",
  activeTitle: "ambientThoughts.ts - Ari",
  userIdleSeconds: 42,
  companionSilenceMs: 9 * 60_000,
  pomodoroPhase: "idle",
  focusActive: true,
  characterState: "listening" as const,
};

describe("ambientThoughts", () => {
  beforeEach(() => {
    setupStorage();
    resetAmbientThoughtsForTests();
    vi.mocked(completeLlmJson).mockReset();
  });

  it("uses LLM output for ambient thoughts and stores only recent anti-repeat memory", async () => {
    vi.mocked(completeLlmJson).mockResolvedValue({
      shouldShow: true,
      text: "Сейчас у кода такой вид, будто он почти согласился.",
      emotion: "amused",
    });

    const thought = await generateAmbientThought(defaultSettings, baseInput);

    expect(thought).toEqual({
      text: "Сейчас у кода такой вид, будто он почти согласился.",
      emotion: "amused",
    });
    expect(getRecentAmbientThoughts()).toContain(thought!.text);
    expect(completeLlmJson).toHaveBeenCalledWith(
      expect.any(Array),
      defaultSettings,
      180,
      "initiativeSynthesis",
    );
  });

  it("rejects generic questions and near repeats", () => {
    rememberAmbientThought("Сейчас у кода такой вид, будто он почти согласился.");

    expect(validateAmbientThought("Как дела?")).toBe(false);
    expect(validateAmbientThoughtDetailed("Как дела?").issues).toContain(
      "question",
    );
    expect(
      validateAmbientThought("У кода сейчас такой вид, будто он почти согласился."),
    ).toBe(false);
    expect(
      validateAmbientThoughtDetailed(
        "У кода сейчас такой вид, будто он почти согласился.",
      ).issues,
    ).toContain("repeat");
    expect(validateAmbientThought("В этом окне явно пахнет маленькой победой.")).toBe(
      true,
    );
  });

  it("rejects thoughts addressed to the user", () => {
    const result = validateAmbientThoughtDetailed(
      "Ты явно устал, давай выдохнем немного.",
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContain("addressed_user");
  });

  it("allows idle inner thoughts without proactive message settings", () => {
    expect(
      shouldAttemptAmbientThought({
        providerOnline: true,
        avatarLivelinessEnabled: true,
        chatOpen: false,
        characterState: "idle",
        quietModeActive: false,
        hasVisibleBubble: false,
        busy: false,
        elapsedSinceLastMs: ambientThoughtCooldownMs({
          userIdleSeconds: 14 * 60,
          companionSilenceMs: 21 * 60_000,
          attention: "daydreaming",
        }),
        userIdleSeconds: 14 * 60,
        companionSilenceMs: 21 * 60_000,
        attention: "daydreaming",
      }),
    ).toBe(true);
  });

  it("allows local thoughts more often during focus without LLM", () => {
    expect(
      shouldAttemptLocalAmbientThought({
        avatarLivelinessEnabled: true,
        chatOpen: false,
        characterState: "thinking",
        quietModeActive: false,
        hasVisibleBubble: false,
        elapsedSinceLastMs: 0,
        elapsedSinceLastLocalMs: localAmbientThoughtCooldownMs({
          attention: "observing",
          focusActive: true,
          companionSilenceMs: 90_000,
        }),
        userIdleSeconds: 12,
        companionSilenceMs: 90_000,
        attention: "observing",
        focusActive: true,
      }),
    ).toBe(true);

    const thought = pickLocalAmbientThought(baseInput);
    expect(thought).not.toBeNull();
    expect(getRecentAmbientThoughts()).toContain(thought!.text);
    expect(completeLlmJson).not.toHaveBeenCalled();
  });

  it("blocks ambient thoughts while chat is open", () => {
    expect(
      shouldAttemptAmbientThought({
        providerOnline: true,
        avatarLivelinessEnabled: true,
        chatOpen: true,
        characterState: "idle",
        quietModeActive: false,
        hasVisibleBubble: false,
        busy: false,
        elapsedSinceLastMs: 30 * 60_000,
        userIdleSeconds: 20 * 60,
        companionSilenceMs: 30 * 60_000,
        attention: "daydreaming",
      }),
    ).toBe(false);
  });

  it("does not invent fallback text when LLM fails", async () => {
    vi.mocked(completeLlmJson).mockRejectedValue(new Error("offline"));

    await expect(generateAmbientThought(defaultSettings, baseInput)).resolves.toBeNull();
    expect(getRecentAmbientThoughts()).toEqual([]);
  });
});
