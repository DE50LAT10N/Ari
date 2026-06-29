import type { AppSettings } from "../settings/appSettings";

export type VisionSource = "gigachat" | "ollama";

export function getVisionSource(settings: AppSettings): VisionSource {
  if (settings.llmProvider === "ollama") {
    return "ollama";
  }
  return settings.visionSource ?? "gigachat";
}

export function resolveVisionModel(settings: AppSettings): string {
  return getVisionSource(settings) === "gigachat"
    ? settings.gigaChatVisionModel
    : settings.visionModel;
}
