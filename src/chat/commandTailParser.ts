import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import { isLlmProviderOnline } from "../llm/providerOnline";
import { parseTaskTitleAndDue } from "./taskChatParse";

export type CommandTailKind = "task-add" | "reminder" | "goal-add";

type TailResponse = {
  execute?: unknown;
  title?: unknown;
  dueAt?: unknown;
  dueText?: unknown;
  reason?: unknown;
};

export type CommandTailResult = {
  execute: boolean;
  title?: string;
  dueAt?: number;
  reason?: string;
};

function kindLabel(kind: CommandTailKind): string {
  switch (kind) {
    case "goal-add":
      return "цель";
    case "reminder":
      return "напоминание";
    default:
      return "задача";
  }
}

function fallbackFromTail(tail: string): CommandTailResult {
  const parsed = parseTaskTitleAndDue(tail);
  if (!parsed.title) {
    return { execute: false, reason: "пустой заголовок" };
  }
  return { execute: true, title: parsed.title, dueAt: parsed.dueAt };
}

export async function parseCommandTail(
  settings: AppSettings,
  kind: CommandTailKind,
  tail: string,
  fullInput: string,
  ollamaOnline: boolean | null = null,
): Promise<CommandTailResult> {
  const trimmed = tail.trim();
  if (!trimmed) {
    return { execute: false, reason: "пустой хвост команды" };
  }

  if (!isLlmProviderOnline(settings, ollamaOnline)) {
    return fallbackFromTail(trimmed);
  }

  try {
    const response = await completeLlmJson<TailResponse>(
      [
        {
          role: "system",
          content: [
            "Разбери хвост команды пользователя для Ari.",
            "execute=false если это обсуждение формулировки, пример, вопрос «как добавить», мета про regex/команды — а не реальная команда выполнить.",
            "execute=true только если пользователь явно хочет создать запись с конкретным содержанием.",
            'JSON: {"execute":true|false,"title":"...","dueText":"опционально","reason":"если false"}.',
            "dueText — только если явно указано время; title без времени.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Тип: ${kindLabel(kind)} (${kind})`,
            `Полная фраза: ${fullInput}`,
            `Хвост: ${trimmed}`,
          ].join("\n"),
        },
      ],
      settings,
      220,
      "json",
    );

    if (response.execute === false) {
      return {
        execute: false,
        reason:
          typeof response.reason === "string"
            ? response.reason.trim()
            : "не команда",
      };
    }

    let title =
      typeof response.title === "string" ? response.title.trim() : "";
    let dueAt =
      typeof response.dueAt === "number" && Number.isFinite(response.dueAt)
        ? response.dueAt
        : undefined;

    if (!title && typeof response.dueText === "string" && response.dueText.trim()) {
      const parsed = parseTaskTitleAndDue(response.dueText.trim());
      title = parsed.title;
      dueAt = dueAt ?? parsed.dueAt;
    }

    if (!title) {
      const parsed = parseTaskTitleAndDue(trimmed);
      title = parsed.title;
      dueAt = dueAt ?? parsed.dueAt;
    }

    if (!title) {
      return { execute: false, reason: "нет заголовка" };
    }

    if (!dueAt && typeof response.dueText === "string" && response.dueText.trim()) {
      const parsed = parseTaskTitleAndDue(
        `${response.dueText.trim()} ${title}`,
      );
      dueAt = parsed.dueAt ?? dueAt;
    }

    return { execute: true, title, dueAt };
  } catch {
    return fallbackFromTail(trimmed);
  }
}
