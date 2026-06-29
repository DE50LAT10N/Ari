import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { FocusSession } from "./focusSession";
import { getFocusSessionDurationMinutes } from "./focusSession";

export type FocusRecapResult = {
  done: string;
  stuck: string;
  nextStep: string;
  summary: string;
};

type FocusRecapResponse = {
  done?: unknown;
  stuck?: unknown;
  nextStep?: unknown;
};

export async function generateFocusRecap(
  session: FocusSession,
  settings: AppSettings,
): Promise<FocusRecapResult> {
  const duration = getFocusSessionDurationMinutes(session);
  const interruptions = session.interruptions.length;

  try {
    const response = await completeLlmJson<FocusRecapResponse>(
      [
        {
          role: "system",
          content: [
            "Сделай короткий recap фокус-сессии на русском.",
            'Верни JSON: {"done":"что сделано","stuck":"где застряло","nextStep":"следующий шаг"}.',
            "Будь конкретной, без мотивационных клише. 1-2 предложения на поле.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Цель: ${session.goal}`,
            session.successCriteria
              ? `Критерий успеха: ${session.successCriteria}`
              : "",
            `План: ${session.plannedMinutes} мин, факт: ${duration} мин`,
            `Прерываний: ${interruptions}`,
            session.forbiddenApps?.length
              ? `Избегать: ${session.forbiddenApps.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      settings,
      220,
      "json",
    );

    const done =
      typeof response.done === "string" && response.done.trim()
        ? response.done.trim()
        : `Продержался ${duration} минут по цели «${session.goal}».`;
    const stuck =
      typeof response.stuck === "string" && response.stuck.trim()
        ? response.stuck.trim()
        : interruptions > 0
          ? `Было ${interruptions} отвлечений.`
          : "Застреваний не отмечено.";
    const nextStep =
      typeof response.nextStep === "string" && response.nextStep.trim()
        ? response.nextStep.trim()
        : "Выбери один маленький следующий шаг и начни с него.";

    return {
      done,
      stuck,
      nextStep,
      summary: [
        `${duration} минут позади — неплохо.`,
        done,
        stuck !== "Застреваний не отмечено."
          ? `Застряли тут: ${stuck}`
          : "Без явных затыков.",
        `Дальше бы я: ${nextStep}`,
      ].join(" "),
    };
  } catch {
    return {
      done: `Работал над «${session.goal}» ${duration} мин.`,
      stuck:
        interruptions > 0
          ? `${interruptions} отвлечений за сессию.`
          : "Без явных застреваний.",
      nextStep: "Один конкретный шаг — и снова в фокус.",
      summary: [
        `${duration} минут с «${session.goal}».`,
        interruptions > 0
          ? `Отвлекались ${interruptions} раз — бывает.`
          : "Держались ровно, без отвлечений.",
        "Следующий шаг — один маленький, но конкретный.",
      ].join(" "),
    };
  }
}
