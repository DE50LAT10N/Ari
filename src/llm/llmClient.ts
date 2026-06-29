import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion } from "../types/character";
import type { ModelTask } from "./modelRouter";
import {
  completeLocalLlmJson,
  streamLocalLlm,
} from "./localLlmClient";
import {
  completeGigaChatJson,
  streamGigaChat,
} from "./gigaChatClient";

export type { ModelTask } from "./modelRouter";
export { resolveModel } from "./modelRouter";

export function completeLlmJson<T>(
  messages: ChatMessage[],
  settings: AppSettings,
  maxTokens?: number,
  task: ModelTask = "json",
): Promise<T> {
  return settings.llmProvider === "gigachat"
    ? completeGigaChatJson<T>(messages, settings, maxTokens, task)
    : completeLocalLlmJson<T>(messages, settings, maxTokens, task);
}

export function streamLlm(
  messages: ChatMessage[],
  settings: AppSettings,
  onUpdate: (content: string) => void,
  onEmotion: (emotion: CharacterEmotion) => void,
  signal: AbortSignal,
): Promise<string> {
  return settings.llmProvider === "gigachat"
    ? streamGigaChat(messages, settings, onUpdate, onEmotion, signal)
    : streamLocalLlm(messages, settings, onUpdate, onEmotion, signal);
}
