export type UserIntent =
  | "question"
  | "task_command"
  | "request_action"
  | "emotional_support"
  | "technical_help"
  | "feedback"
  | "smalltalk";

export type UserIntentResult = {
  intent: UserIntent;
  confidence: number;
};

type IntentRule = {
  intent: UserIntent;
  pattern: RegExp;
  weight: number;
};

const INTENT_RULES: IntentRule[] = [
  {
    intent: "task_command",
    pattern:
      /^(?:добавь|добавить|запиши|создай|напомни|поставь|сделано|отложи|список задач|новая задача)/i,
    weight: 0.95,
  },
  {
    intent: "request_action",
    pattern:
      /(?:открой|открыть|запусти|скопируй|создай файл|экспорт|настройк|open |copy |https?:\/\/)/i,
    weight: 0.88,
  },
  {
    intent: "emotional_support",
    pattern:
      /(?:мне плохо|грустно|страшно|тревожно|устал|одиноко|не справляюсь|поддержи|тяжело|переживаю)/i,
    weight: 0.9,
  },
  {
    intent: "technical_help",
    pattern:
      /(?:ошибк|код|сборк|typescript|rust|tauri|api|сервер|модель|как реализ|почему не работ|баг|лог|компил)/i,
    weight: 0.85,
  },
  {
    intent: "feedback",
    pattern:
      /(?:не так|не надо|хватит|стоп|плохо|отлично|молодец|спасибо|бесит|раздражает|не нрав)/i,
    weight: 0.8,
  },
  {
    intent: "question",
    pattern: /(?:\?|что такое|как |почему |зачем |когда |где |кто |можешь ли|подскажи)/i,
    weight: 0.75,
  },
];

export function classifyUserIntent(text: string): UserIntentResult {
  const normalized = text.trim();
  if (!normalized) {
    return { intent: "smalltalk", confidence: 0.4 };
  }

  let best: UserIntentResult = { intent: "smalltalk", confidence: 0.45 };
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(normalized)) {
      if (rule.weight > best.confidence) {
        best = { intent: rule.intent, confidence: rule.weight };
      }
    }
  }

  if (best.intent === "smalltalk" && normalized.length < 24) {
    return { intent: "smalltalk", confidence: 0.55 };
  }

  return best;
}

export function isHighConfidenceIntent(
  result: UserIntentResult,
  threshold = 0.8,
): boolean {
  return result.confidence >= threshold;
}
