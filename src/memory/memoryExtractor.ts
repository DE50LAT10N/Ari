import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";

export type ExtractedMemoryFact = {
  text: string;
  importance: "trivial" | "useful" | "important" | "core";
  confidence: number;
};

type MemorySummaryResponse = {
  title?: unknown;
  summary?: unknown;
};

export async function summarizeUserFacts(
  facts: Array<{ id: string; text: string }>,
  settings: AppSettings,
): Promise<{ title: string; text: string }> {
  const response = await completeLlmJson<MemorySummaryResponse>(
    [
      {
        role: "system",
        content: [
          "Сожми набор долговременных фактов о пользователе в тематическую сводку.",
          "Все поля JSON пиши только на русском языке.",
          "Сохрани конкретные предпочтения, проекты, привычки, цели и ограничения. Удали только точные повторы.",
          "Не делай выводов, не описывай возможные сложности, решения или общие знания по теме.",
          "Не превращай факты в статью. Сводка должна быть плотным перечислением только исходных утверждений.",
          "Запрещено добавлять что-либо, чего дословно или однозначно нет в исходных фактах.",
          'Верни JSON: {"title":"короткая тема","summary":"компактная связная сводка"}.',
        ].join("\n"),
      },
      {
        role: "user",
        content: facts.map(({ text }, index) => `${index + 1}. ${text}`).join("\n"),
      },
    ],
    settings,
    700,
    "summarization",
  );

  if (
    typeof response.title !== "string" ||
    typeof response.summary !== "string" ||
    !response.summary.trim()
  ) {
    throw new Error("Модель не создала сводку памяти.");
  }

  const sourceWords = new Set(
    facts
      .flatMap(({ text }) => text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []),
  );
  const summaryWords =
    response.summary.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const overlap = summaryWords.filter((word) => sourceWords.has(word)).length;
  const looksRussian = /[а-яё]/i.test(
    `${response.title} ${response.summary}`,
  );
  const sufficientlyGrounded =
    overlap >= Math.min(5, Math.max(2, Math.ceil(sourceWords.size * 0.1)));

  if (!looksRussian || !sufficientlyGrounded) {
    return {
      title: "Факты о пользователе",
      text: facts.map(({ text }) => `• ${text}`).join("\n").slice(0, 4000),
    };
  }

  return {
    title: response.title.trim().slice(0, 120) || "Память о пользователе",
    text: response.summary.trim().slice(0, 4000),
  };
}
