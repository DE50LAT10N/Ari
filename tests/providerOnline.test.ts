import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  isLlmProviderOnline,
  isVisionProviderOnline,
} from "../src/llm/providerOnline";
import {
  resetGigaChatStatusForTests,
  setGigaChatAuthKeyPresent,
} from "../src/llm/gigaChatStatus";

describe("providerOnline", () => {
  beforeEach(() => {
    resetGigaChatStatusForTests();
  });

  it("treats ollama poll as online for ollama provider", () => {
    const settings = { ...defaultSettings, llmProvider: "ollama" as const };
    expect(isLlmProviderOnline(settings, true)).toBe(true);
    expect(isLlmProviderOnline(settings, false)).toBe(false);
    expect(isLlmProviderOnline(settings, null)).toBe(false);
  });

  it("uses App poll for GigaChat when cache is cold", () => {
    const settings = { ...defaultSettings, llmProvider: "gigachat" as const };
    expect(isLlmProviderOnline(settings, true)).toBe(true);
    expect(isVisionProviderOnline(settings, true)).toBe(true);
  });

  it("falls back to GigaChat cache when poll is null", () => {
    const settings = { ...defaultSettings, llmProvider: "gigachat" as const };
    setGigaChatAuthKeyPresent(true);
    expect(isLlmProviderOnline(settings, null)).toBe(true);
  });

  it("reports offline when GigaChat poll and cache disagree negatively", () => {
    const settings = { ...defaultSettings, llmProvider: "gigachat" as const };
    setGigaChatAuthKeyPresent(false);
    expect(isLlmProviderOnline(settings, false)).toBe(false);
    expect(isLlmProviderOnline(settings, null)).toBe(false);
  });
});
