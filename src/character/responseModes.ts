export type ResponseMode =
  | "casual"
  | "technical_help"
  | "emotional_support"
  | "teasing"
  | "serious_warning"
  | "vision_commentary"
  | "reminder"
  | "return_reaction"
  | "idle_initiative";

import {
  classifyUserIntent,
  isHighConfidenceIntent,
  type UserIntent,
} from "./userIntent";
import type { InitiativeKind } from "./initiativeKinds";

export function intentToResponseMode(intent: UserIntent): ResponseMode | null {
  const map: Record<UserIntent, ResponseMode> = {
    emotional_support: "emotional_support",
    technical_help: "technical_help",
    feedback: "casual",
    question: "casual",
    task_command: "reminder",
    request_action: "technical_help",
    smalltalk: "casual",
  };
  return map[intent];
}

export function proactiveKindToResponseMode(
  kind: InitiativeKind,
): ResponseMode {
  switch (kind) {
    case "return_reaction":
      return "return_reaction";
    case "unfinished_thread":
    case "memory_callback":
      return "reminder";
    case "process_advice":
    case "screen_glance":
      return "technical_help";
    case "break_suggestion":
    case "distraction_nudge":
    case "quiet_presence":
      return "emotional_support";
  }
  return "idle_initiative";
}

export function classifyResponseModeWithIntent({
  message,
  proactive,
  screenObservation,
  eventDescription,
  initiativeKind,
  useIntentClassifier = false,
}: {
  message: string;
  proactive?: boolean;
  screenObservation?: boolean;
  eventDescription?: string;
  initiativeKind?: InitiativeKind;
  useIntentClassifier?: boolean;
}): ResponseMode {
  if (screenObservation) return "vision_commentary";
  const event = eventDescription?.toLowerCase() ?? "";
  if (/срок|напомин|намерен|незаверш/.test(event)) return "reminder";
  if (/вернул|возвращ/.test(event)) return "return_reaction";
  if (proactive && initiativeKind) {
    return proactiveKindToResponseMode(initiativeKind);
  }
  if (proactive) return "idle_initiative";

  if (useIntentClassifier) {
    const intent = classifyUserIntent(message);
    if (isHighConfidenceIntent(intent, 0.82)) {
      const mapped = intentToResponseMode(intent.intent);
      if (mapped) {
        return mapped;
      }
    }
  }

  const normalized = message.toLowerCase();
  if (/(опасн|срочно|потеря данных|удали|сломал|вирус|парол|ключ|деньги)/i.test(normalized)) {
    return "serious_warning";
  }
  if (/(мне плохо|грустно|страшно|тревожно|устал|одиноко|не справляюсь|поддержи)/i.test(normalized)) {
    return "emotional_support";
  }
  if (/(ошибк|код|сборк|typescript|rust|tauri|api|сервер|модель|как реализ|почему не работ)/i.test(normalized)) {
    return "technical_help";
  }
  if (/(подколи|пошути|дразни|смешн)/i.test(normalized)) return "teasing";
  return "casual";
}

export function classifyResponseMode(
  input: Parameters<typeof classifyResponseModeWithIntent>[0],
): ResponseMode {
  return classifyResponseModeWithIntent(input);
}

export function describeResponseMode(mode: ResponseMode): string {
  return {
    casual: "живой обычный разговор; можно говорить о нерабочем, настроении, играх, музыке, еде и мелочах; естественность важнее пользы, структуры и next step",
    technical_help: "точная техническая помощь; характер сохраняется, но ясность и проверяемые шаги важнее шуток; без тона виртуального помощника и канцелярита",
    emotional_support: "спокойная поддержка без приторности, диагнозов и навязчивого утешения",
    teasing: "доброе поддразнивание без унижения и давления",
    serious_warning: "серьёзное предупреждение; без шуток, преуменьшения риска и ложной уверенности",
    vision_commentary: "наблюдение по разрешённому снимку; отделять видимое от предположений",
    reminder: "мягкое напоминание без требования отчёта",
    return_reaction: "короткая естественная реакция на возвращение",
    idle_initiative: "ненавязчивая самостоятельная реплика с конкретным поводом",
  }[mode];
}
