const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;

export const HABITUAL_TRAILING_QUESTION_PATTERN = new RegExp(
  String.raw`(?:хоч(?:ешь|ешь ли|ете)[^.!?…]{0,90}|могу\s+(?:ещ[её]\s+)?(?:помочь|показать|разобрать|сделать|предложить|объяснить|подсказать)[^.!?…]{0,60}|что\s+думаешь|как\s+тебе|какой\s+раздел|продолжим|ид[её]м\s+дальше|расскажешь|обсудим|заметил|интересн|ладно|правда|а\s+что|окей|ок)\s*[?.!…]*$`,
  "iu",
);

export const TRAILING_SOLICITATION_LEAD = new RegExp(
  String.raw`^(?:хочешь|хотите|может(?:\s+быть)?|не\s+хочешь|давай(?:те)?|как\s+насч[её]т|не\s+желаешь)${E}`,
  "iu",
);

const IMPLICIT_INVITATION_PATTERNS: Array<{ pattern: RegExp; reason: string }> =
  [
    {
      pattern: new RegExp(
        String.raw`${B}если\s+(?:захочешь|понадобится|нужно|интересно)${E}`,
        "iu",
      ),
      reason: "conditional_invite",
    },
    {
      pattern: new RegExp(
        String.raw`${B}когда\s+(?:будешь\s+)?(?:готов|готова|свободен|свободна)${E}`,
        "iu",
      ),
      reason: "deferred_invite",
    },
    {
      pattern: new RegExp(
        String.raw`${B}тебе\s+(?:будет\s+)?(?:стоит|можно|нужно|полезно|лучше)${E}`,
        "iu",
      ),
      reason: "second_person_nudge",
    },
    {
      pattern: new RegExp(
        String.raw`${B}(?:давай|давайте)\s+(?:посмотрим|разберём|продолжим|вернёмся|углубимся|сделаем)${E}`,
        "iu",
      ),
      reason: "lets_continue",
    },
    {
      pattern: new RegExp(
        String.raw`${B}(?:расскажешь|расскаж(?:и|ите)|опишешь|уточнишь|скажи|покажешь)${E}`,
        "iu",
      ),
      reason: "direct_prompt",
    },
    {
      pattern: new RegExp(
        String.raw`${B}интересно\s+(?:узнать|послушать|обсудить)${E}`,
        "iu",
      ),
      reason: "interest_hook",
    },
    {
      pattern: new RegExp(
        String.raw`${B}готов(?:а)?\s+(?:обсудить|разобрать|помочь|подсказать|показать)${E}`,
        "iu",
      ),
      reason: "readiness_offer",
    },
    {
      pattern: new RegExp(
        String.raw`${B}(?:обсуд(?:им|ить)|разбер(?:ём|ить)|посмотрим|продолжим|вернёмся|углубимся)${E}[^.!?…]{0,50}${B}(?:вместе|подробнее|дальше|это|тему|документ)${E}`,
        "iu",
      ),
      reason: "topic_continuation",
    },
  ];

const SOFT_CONTINUATION_ENDING = new RegExp(
  String.raw`${B}(?:обсудить|разобрать|посмотреть|уточнить|продолжить|углубиться|вернуться|помочь|подсказать|предложить|рассказать)${E}[^.!?…]{0,48}[.!…]*$`,
  "iu",
);

const META_QUESTION_INVITE = new RegExp(
  String.raw`${B}похоже\s+на\s+вопрос${E}[^.!?…]{0,90}${B}(?:хочешь|обсуд|расскаж|уточн|посмотр)`,
  "iu",
);

const SECOND_PERSON = new RegExp(
  String.raw`${B}(?:ты|тебе|тебя|вам|вас)${E}`,
  "iu",
);

export type SolicitationSemantics = {
  isSolicitation: boolean;
  confidence: number;
  reasons: string[];
};

export function getLastSentence(text: string): string {
  const parts = text
    .split(/(?<=[.!?…])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? text.trim();
}

export function classifySolicitationSemantics(
  sentence: string,
): SolicitationSemantics {
  const trimmed = sentence.trim();
  const reasons: string[] = [];
  let score = 0;

  if (!trimmed) {
    return { isSolicitation: false, confidence: 0, reasons };
  }

  if (HABITUAL_TRAILING_QUESTION_PATTERN.test(trimmed)) {
    score += 0.92;
    reasons.push("habitual_tail");
  }
  if (TRAILING_SOLICITATION_LEAD.test(trimmed)) {
    score += 0.88;
    reasons.push("solicitation_lead");
  }
  if (META_QUESTION_INVITE.test(trimmed)) {
    score += 0.9;
    reasons.push("meta_question_invite");
  }

  for (const entry of IMPLICIT_INVITATION_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      score += 0.42;
      reasons.push(entry.reason);
    }
  }

  if (SOFT_CONTINUATION_ENDING.test(trimmed)) {
    score += 0.38;
    reasons.push("continuation_verb");
  }

  if (SECOND_PERSON.test(trimmed) && SOFT_CONTINUATION_ENDING.test(trimmed)) {
    score += 0.22;
    reasons.push("second_person_continuation");
  }

  return {
    isSolicitation: score >= 0.75,
    confidence: Math.min(1, score),
    reasons: [...new Set(reasons)],
  };
}

export function isSolicitationSentence(sentence: string): boolean {
  return classifySolicitationSemantics(sentence).isSolicitation;
}
