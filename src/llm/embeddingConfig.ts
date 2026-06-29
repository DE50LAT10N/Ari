import type { AppSettings } from "../settings/appSettings";
import { getVisionSource } from "./visionConfig";

export type EmbeddingSource = "gigachat" | "ollama" | "none";

export function getEmbeddingSource(settings: AppSettings): EmbeddingSource {
  if (settings.llmProvider === "ollama") {
    return "ollama";
  }
  return settings.embeddingSource ?? "gigachat";
}

export function isEmbeddingSourceConfigured(settings: AppSettings): boolean {
  return getEmbeddingSource(settings) !== "none";
}

export function resolveEmbeddingModel(settings: AppSettings): string {
  const source = getEmbeddingSource(settings);
  if (source === "gigachat") {
    return settings.gigaChatEmbeddingModel;
  }
  return settings.embeddingModel;
}

export function usesLocalOllamaAuxiliary(settings: AppSettings): boolean {
  if (settings.llmProvider === "ollama") {
    return false;
  }
  return (
    getEmbeddingSource(settings) === "ollama" ||
    getVisionSource(settings) === "ollama"
  );
}
