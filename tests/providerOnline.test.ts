import { beforeEach, describe, expect, it } from "vitest";
import { isLlmProviderOnline } from "../src/llm/providerOnline";
import {
  resetGigaChatStatusForTests,
  setGigaChatAuthKeyPresent,
} from "../src/llm/gigaChatStatus";
import { defaultSettings } from "../src/settings/appSettings";

describe("provider online", () => {
  beforeEach(() => {
    resetGigaChatStatusForTests();
  });

  it("keeps GigaChat online when auth cache is present and poll is still null", () => {
    setGigaChatAuthKeyPresent(true);

    expect(
      isLlmProviderOnline(
        { ...defaultSettings, llmProvider: "gigachat" },
        null,
      ),
    ).toBe(true);
  });

  it("requires true Ollama poll for local provider", () => {
    expect(
      isLlmProviderOnline({ ...defaultSettings, llmProvider: "ollama" }, null),
    ).toBe(false);
  });
});
