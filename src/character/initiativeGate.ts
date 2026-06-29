import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import { getRecentProactiveTopics } from "./proactiveState";

type InitiativeDecision = {
  shouldSend?: unknown;
  topic?: unknown;
};

export async function shouldSendInitiative(
  history: ChatMessage[],
  context: string,
  settings: AppSettings,
): Promise<{ shouldSend: boolean; topic: string }> {
  const recent = history
    .slice(-8)
    .map(({ role, content }) => `${role}: ${content}`)
    .join("\n");
  const recentTopics = getRecentProactiveTopics();
  const response = await completeLlmJson<InitiativeDecision>(
    [
      {
        role: "system",
        content: [
          "Реши, стоит ли desktop-персонажу Ari сейчас самой писать пользователю.",
          "Откажись, если нет конкретного полезного, заботливого или уместно-ироничного повода.",
          "Откажись при риске повторить недавнюю реплику или отвлечь без причины.",
          "Не выбирай тему, смысл которой уже есть в списке недавних инициатив.",
          'Верни JSON: {"shouldSend":true|false,"topic":"короткая причина или тема"}.',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Контекст события:\n${context}`,
          `Недавний разговор:\n${recent || "нет"}`,
          `Недавние инициативы:\n${recentTopics.join("\n") || "нет"}`,
        ].join("\n\n"),
      },
    ],
    settings,
    120,
    "initiativeGate",
  );

  return {
    shouldSend: response.shouldSend === true,
    topic: typeof response.topic === "string" ? response.topic.trim() : "",
  };
}
