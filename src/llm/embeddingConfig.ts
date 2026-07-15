import type { AppSettings } from "../settings/appSettings";
import { getVisionSource } from "./visionConfig";

export type EmbeddingSource = "gigachat" | "ollama" | "none";

export function getEmbeddingSource(settings: AppSettings): EmbeddingSource {
  const configured = settings.embeddingSource ?? "gigachat";
  if (configured !== "none") {
    return configured;
  }
  return settings.llmProvider === "ollama" ? "ollama" : "gigachat";
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
  return (
    getEmbeddingSource(settings) === "ollama" ||
    getVisionSource(settings) === "ollama"
  );
}
