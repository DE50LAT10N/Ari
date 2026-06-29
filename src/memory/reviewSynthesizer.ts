import type { AppSettings } from "../settings/appSettings";
import { completeLlmJson } from "../llm/llmClient";
import {
  buildDailyReview,
  buildWeeklyReview,
  formatDailyReview,
  formatWeeklyReview,
  type DailyReview,
  type WeeklyReview,
} from "./reviewAggregator";
import { appendTimelineEvent } from "./activityTimeline";

type SynthesisResult = { text: string };

export async function synthesizeDailyReview(
  settings: AppSettings,
): Promise<string> {
  const review = buildDailyReview();
  try {
    const result = await completeLlmJson<SynthesisResult>(
      [
        {
          role: "user",
          content: [
            "Сожми дневной обзор в 4–6 живых фраз на русском от лица Ari-компаньона.",
            "Без списков markdown, без упоминания «системы» и «таймлайна».",
            "Данные:",
            formatDailyReview(review),
          ].join("\n"),
        },
      ],
      settings,
      400,
      "json",
    );
    if (result.text?.trim()) {
      appendTimelineEvent({ kind: "review", summary: "Дневной обзор" });
      return result.text.trim();
    }
  } catch {
    // fallback below
  }
  appendTimelineEvent({ kind: "review", summary: "Дневной обзор (шаблон)" });
  return formatDailyReview(review);
}

export async function synthesizeWeeklyReview(
  settings: AppSettings,
): Promise<string> {
  const review = buildWeeklyReview();
  try {
    const result = await completeLlmJson<SynthesisResult>(
      [
        {
          role: "user",
          content: [
            "Сделай короткий недельный обзор 5–8 фраз: темы, блокеры, куда двигаться.",
            "Тон Ari — тёплый, без канцелярита.",
            "Данные:",
            formatWeeklyReview(review),
          ].join("\n"),
        },
      ],
      settings,
      500,
      "json",
    );
    if (result.text?.trim()) {
      appendTimelineEvent({ kind: "review", summary: "Недельный обзор" });
      return result.text.trim();
    }
  } catch {
    // fallback
  }
  appendTimelineEvent({ kind: "review", summary: "Недельный обзор (шаблон)" });
  return formatWeeklyReview(review);
}

export async function synthesizeTestPlan(
  settings: AppSettings,
  moduleName: string,
): Promise<string> {
  const review: DailyReview = buildDailyReview();
  try {
    const result = await completeLlmJson<SynthesisResult>(
      [
        {
          role: "user",
          content: [
            `Составь практичный план тестирования для модуля «${moduleName}».`,
            "5–7 пунктов, русский язык, без воды.",
            review.stuck.length
              ? `Текущие блокеры: ${review.stuck.join("; ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      settings,
      500,
      "json",
    );
    if (result.text?.trim()) {
      return result.text.trim();
    }
  } catch {
    // fallback
  }
  return [
    `План тестирования для ${moduleName}:`,
    "1. Smoke: запуск и базовые сценарии.",
    "2. Unit: граничные случаи и ошибки ввода.",
    "3. Integration: связки с соседними модулями.",
    "4. Regression: проверка критичных путей.",
    "5. Manual: UI и read-only сценарии.",
  ].join("\n");
}

export type { DailyReview, WeeklyReview };
