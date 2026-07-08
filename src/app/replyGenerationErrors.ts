import type { AppSettings } from "../settings/appSettings";

export function getErrorMessage(
  error: unknown,
  provider: AppSettings["llmProvider"],
): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Не удалось получить ответ от модели.";
  if (provider === "gigachat") {
    if (/401|403|unauthorized|auth/i.test(message)) {
      return `GigaChat не принял ключ: ${message}. Проверь авторизацию в настройках.`;
    }
    if (/timeout|network|fetch|connection|offline|refused/i.test(message)) {
      return `GigaChat не отвечает: ${message}. Сеть или API решили отдохнуть.`;
    }
    return message;
  }
  if (/ollama|fetch|connection|network|offline|refused/i.test(message)) {
    return `Ollama не отвечает: ${message}. Хм. Мозг снаружи решил помедитировать.`;
  }
  if (/vision|qwen2\.5vl|model.*not found/i.test(message)) {
    return `Vision-модель недоступна: ${message}. Глаз не открылся - смотреть мне пока нечем.`;
  }
  if (/embedding|index|pdf|rag/i.test(message)) {
    return `RAG не обработал данные: ${message}. Документ решил быть вредным.`;
  }
  return message;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.message.toLowerCase().includes("cancel")))
  );
}

export function describeProactiveFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 120);
  }
  return String(error).slice(0, 120);
}
