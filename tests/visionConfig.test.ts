import { describe, expect, it } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import { getEmbeddingSource, usesLocalOllamaAuxiliary } from "../src/llm/embeddingConfig";
import {
  getVisionSource,
  resolveVisionModel,
} from "../src/llm/visionConfig";

describe("visionConfig", () => {
  it("uses ollama vision when configured in gigachat mode", () => {
    const settings = {
      ...defaultSettings,
      llmProvider: "gigachat" as const,
      visionSource: "ollama" as const,
      visionModel: "qwen2.5vl:7b",
      gigaChatVisionModel: "GigaChat",
    };
    expect(getVisionSource(settings)).toBe("ollama");
    expect(resolveVisionModel(settings)).toBe("qwen2.5vl:7b");
    expect(usesLocalOllamaAuxiliary(settings)).toBe(true);
  });

  it("keeps selected gigachat vision while privacy-default embeddings stay local", () => {
    const settings = {
      ...defaultSettings,
      llmProvider: "gigachat" as const,
      visionSource: "gigachat" as const,
    };
    expect(getVisionSource(settings)).toBe("gigachat");
    expect(resolveVisionModel(settings)).toBe(settings.gigaChatVisionModel);
    expect(getEmbeddingSource(settings)).toBe("ollama");
    expect(usesLocalOllamaAuxiliary(settings)).toBe(true);
  });

  it("detects local embeddings auxiliary without local vision", () => {
    const settings = {
      ...defaultSettings,
      llmProvider: "gigachat" as const,
      embeddingSource: "ollama" as const,
      visionSource: "gigachat" as const,
    };
    expect(getEmbeddingSource(settings)).toBe("ollama");
    expect(usesLocalOllamaAuxiliary(settings)).toBe(true);
  });

  it("respects explicit gigachat embeddings in ollama chat mode", () => {
    const settings = {
      ...defaultSettings,
      llmProvider: "ollama" as const,
      embeddingSource: "gigachat" as const,
    };
    expect(getEmbeddingSource(settings)).toBe("gigachat");
    expect(usesLocalOllamaAuxiliary(settings)).toBe(true);
  });
});
