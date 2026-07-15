import type { AppSettings } from "../settings/appSettings";
import { resolveEmbeddingModel } from "./embeddingConfig";
import { resolveVisionModel } from "./visionConfig";
import { isLiteGigaChatModelId, resolveGigaChatAuxModel } from "./gigaChatModels";

export type ModelTask =
  | "chat"
  | "json"
  | "validator"
  | "memoryExtraction"
  | "initiativeGate"
  | "initiativeSynthesis"
  | "vision"
  | "embedding"
  | "summarization";

export type ModelRoutingConfig = {
  chatModel: string;
  fastJsonModel?: string;
  memoryModel?: string;
  visionModel: string;
  embeddingModel: string;
};

export function resolveModel(
  task: ModelTask,
  settings: AppSettings,
): string {
  const isGigaChat = settings.llmProvider === "gigachat";

  switch (task) {
    case "chat":
      return isGigaChat ? settings.gigaChatModel : settings.model;
    case "initiativeGate":
    case "initiativeSynthesis":
    case "validator":
    case "json":
      if (isGigaChat) {
        return resolveGigaChatAuxModel(
          settings.gigaChatModel,
          settings.fastJsonModel,
        );
      }
      return settings.fastJsonModel || settings.model;
    case "memoryExtraction":
    case "summarization":
      if (isGigaChat) {
        return resolveGigaChatAuxModel(
          settings.gigaChatModel,
          settings.memoryModel,
        );
      }
      return settings.memoryModel || settings.model;
    case "vision":
      return resolveVisionModel(settings);
    case "embedding":
      return resolveEmbeddingModel(settings);
    default:
      return isGigaChat ? settings.gigaChatModel : settings.model;
  }
}

/** Lite / small models may need stricter validation and retrying. */
export function isLiteLlmModel(settings: AppSettings): boolean {
  if (settings.llmProvider === "gigachat") {
    return isLiteGigaChatModelId(resolveModel("json", settings));
  }
  const model = settings.fastJsonModel || settings.model;
  return /lite|mini|1b|3b/i.test(model);
}

export function resolveSynthesisModel(settings: AppSettings): string {
  // Respect the model tier selected by the user. Silently upgrading a Lite
  // account to Pro turns a model-specific HTTP 402 into a total loss of
  // proactive speech, even though the selected live model remains available.
  return resolveModel("initiativeSynthesis", settings);
}

export function resolveEffectiveGigaChatVisionModel(
  settings: AppSettings,
): string {
  if (settings.llmProvider !== "gigachat") {
    return settings.visionModel;
  }
  return resolveGigaChatAuxModel(
    settings.gigaChatModel,
    settings.gigaChatVisionModel,
  );
}
