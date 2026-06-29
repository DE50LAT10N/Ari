import type { AppSettings } from "../settings/appSettings";
import { isGigaChatProviderOnline } from "./gigaChatStatus";

export function isLlmProviderOnline(
  settings: AppSettings,
  ollamaOnline: boolean | null,
): boolean {
  if (settings.llmProvider === "gigachat") {
    // App polls checkGigaChatStatus into ollamaOnline; cache may lag before first refresh.
    return ollamaOnline === true || isGigaChatProviderOnline();
  }
  return ollamaOnline === true;
}

export function isVisionProviderOnline(
  settings: AppSettings,
  ollamaOnline: boolean | null,
): boolean {
  if (settings.llmProvider === "gigachat") {
    return ollamaOnline === true || isGigaChatProviderOnline();
  }
  return ollamaOnline === true;
}
