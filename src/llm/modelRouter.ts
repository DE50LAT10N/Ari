import type { AppSettings } from "../settings/appSettings";
import { resolveEmbeddingModel } from "./embeddingConfig";
import { resolveVisionModel } from "./visionConfig";

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
        return settings.fastJsonModel || settings.gigaChatModel;
      }
      return settings.fastJsonModel || settings.model;
    case "memoryExtraction":
    case "summarization":
      if (isGigaChat) {
        return settings.memoryModel || settings.gigaChatModel;
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
