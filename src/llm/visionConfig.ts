import type { AppSettings } from "../settings/appSettings";
import { resolveGigaChatAuxModel } from "./gigaChatModels";

export type VisionSource = "gigachat" | "ollama";

export function getVisionSource(settings: AppSettings): VisionSource {
  if (settings.llmProvider === "ollama") {
    return "ollama";
  }
  return settings.visionSource ?? "gigachat";
}

export function resolveVisionModel(settings: AppSettings): string {
  if (getVisionSource(settings) === "gigachat") {
    return resolveGigaChatAuxModel(
      settings.gigaChatModel,
      settings.gigaChatVisionModel,
    );
  }
  return settings.visionModel;
}
