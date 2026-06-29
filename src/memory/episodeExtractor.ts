import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type { OpenLoop } from "./episodicMemory";

type EpisodeExtractionResponse = {
  episode?: unknown;
  openLoops?: unknown;
  resolvedLoopIds?: unknown;
};

export async function extractEpisodeAndLoops(
  userMessage: string,
  assistantReply: string,
  existingLoops: OpenLoop[],
  settings: AppSettings,
): Promise<{
  episode: { title: string; text: string } | null;
  openLoops: Array<{ text: string; dueAt?: number; confidence?: number }>;
  resolvedLoopIds: string[];
}> {
  const response = await completeLlmJson<EpisodeExtractionResponse>(
    [
      {
        role: "system",
        content: [
          "Обнови эпизодическую память разговора.",
          "Эпизод сохраняй только если произошло конкретное совместное событие: решили проблему, приняли решение, начали или завершили значимую работу.",
          "Открытые линии — обещания, планы, вопросы или проверки, к которым разумно вернуться позже.",
          "Если пользователь указал срок или попросил напомнить, добавь dueAt как локальную дату в ISO 8601. Не выдумывай срок, если его нет.",
          "Отмечай линию закрытой только если пользователь явно сообщил результат или отказался от неё.",
          "Не сохраняй обычные приветствия и мелкие одноразовые вопросы.",
          'Верни JSON: {"episode":{"title":"тема","text":"что произошло"}|null,"openLoops":[{"text":"что осталось сделать","dueAt":"2026-06-26T19:00:00+03:00"|null}],"resolvedLoopIds":["id"]}.',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Сообщение пользователя:\n${userMessage}`,
          `Ответ Ari:\n${assistantReply}`,
          `Текущие локальные дата и время:\n${new Date().toString()}`,
          "Текущие открытые линии:",
          existingLoops.length
            ? existingLoops.map(({ id, text }) => `${id}: ${text}`).join("\n")
            : "нет",
        ].join("\n\n"),
      },
    ] satisfies ChatMessage[],
    settings,
    500,
    "memoryExtraction",
  );

  const episodeValue = response.episode;
  const episode =
    episodeValue &&
    typeof episodeValue === "object" &&
    typeof (episodeValue as { title?: unknown }).title === "string" &&
    typeof (episodeValue as { text?: unknown }).text === "string"
      ? {
          title: (episodeValue as { title: string }).title.trim(),
          text: (episodeValue as { text: string }).text.trim(),
        }
      : null;

  return {
    episode: episode?.text ? episode : null,
    openLoops: Array.isArray(response.openLoops)
      ? response.openLoops.flatMap((value) => {
          if (typeof value === "string") return [{ text: value }];
          if (
            !value ||
            typeof value !== "object" ||
            typeof (value as { text?: unknown }).text !== "string"
          ) {
            return [];
          }
          const rawDueAt = (value as { dueAt?: unknown }).dueAt;
          const parsedDueAt =
            typeof rawDueAt === "string" ? Date.parse(rawDueAt) : NaN;
          const rawConfidence = (value as { confidence?: unknown }).confidence;
          const confidence =
            typeof rawConfidence === "number"
              ? Math.max(0.1, Math.min(1, rawConfidence))
              : undefined;
          return [{
            text: (value as { text: string }).text,
            dueAt: Number.isFinite(parsedDueAt) ? parsedDueAt : undefined,
            confidence,
          }];
        })
      : [],
    resolvedLoopIds: Array.isArray(response.resolvedLoopIds)
      ? response.resolvedLoopIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}
