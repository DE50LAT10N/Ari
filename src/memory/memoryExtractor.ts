import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";

type MemoryExtractionResponse = {
  facts?: unknown;
};

export type ExtractedMemoryFact = {
  text: string;
  importance: "trivial" | "useful" | "important" | "core";
  confidence: number;
};

type MemorySummaryResponse = {
  title?: unknown;
  summary?: unknown;
};

export async function extractUserFacts(
  userMessage: string,
  assistantReply: string,
  settings: AppSettings,
): Promise<ExtractedMemoryFact[]> {
  const response = await completeLlmJson<MemoryExtractionResponse>(
    [
      {
        role: "system",
        content: [
          "Извлеки устойчивые и полезные факты о пользователе.",
          "Сохраняй только явно сказанное: имя, предпочтения, привычки, проекты, долгосрочные цели, важные ограничения.",
          "Не сохраняй пароли, ключи, адреса, платёжные данные, медицинские сведения, случайные эмоции и одноразовые задачи.",
          "Оцени важность: trivial, useful, important или core.",
          "trivial: временное настроение, одноразовая фраза, случайная техническая деталь — не сохранять.",
          "Сохраняй только подтверждённое самим пользователем, а не предположения Ari.",
          'Верни JSON строго вида {"facts":[{"text":"короткий факт","importance":"useful","confidence":0.9}]}.',
          "Если сохранять нечего, верни пустой массив.",
        ].join("\n"),
      },
      {
        role: "user",
        content: `Сообщение пользователя:\n${userMessage}\n\nОтвет Ari для контекста:\n${assistantReply}`,
      },
    ] satisfies ChatMessage[],
    settings,
    220,
    "memoryExtraction",
  );

  return Array.isArray(response.facts)
    ? response.facts.flatMap((value): ExtractedMemoryFact[] => {
        if (typeof value === "string") {
          return [{ text: value.trim(), importance: "useful", confidence: 0.65 }];
        }
        if (!value || typeof value !== "object") return [];
        const fact = value as Record<string, unknown>;
        if (typeof fact.text !== "string") return [];
        const importance =
          fact.importance === "trivial" ||
          fact.importance === "useful" ||
          fact.importance === "important" ||
          fact.importance === "core"
            ? fact.importance
            : "useful";
        if (importance === "trivial") return [];
        return [{
          text: fact.text.trim(),
          importance,
          confidence:
            typeof fact.confidence === "number"
              ? Math.max(0.1, Math.min(1, fact.confidence))
              : 0.7,
        }];
      }).filter(({ text }) => Boolean(text)).slice(0, 3)
    : [];
}

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
