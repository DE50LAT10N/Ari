export type ReplyValidationContext = {
  hasVision: boolean;
  hasMemory: boolean;
  hasRag: boolean;
};

export type OocValidationResult = {
  valid: boolean;
  issues: string[];
};

const SERVICE_PHRASE_PATTERN =
  /(?:чем могу помочь|как (?:я )?могу помочь|рад(?:а)? помочь|обращайтесь|готов(?:а)? помочь|виртуальн(?:ый|ая) помощник)/i;

const CORPORATE_PATTERN =
  /(?:отличный выбор|позволяет учесть|данный критерий|в рамках данного|с точки зрения оптимизации)/i;

const MASCULINE_SELF_PATTERN =
  /(?:^|[\s(«"'])я\s+(?:готов|сделал|заметил|уверен|рад|сказал|решил|понял|думал|увидел|услышал)(?:\s|$|[,.!?;:])/iu;

const ASSISTANT_TONE_PATTERN =
  /^(?:конечно|безусловно|разумеется|вот несколько советов|вот список|позвольте)/i;

const HABITUAL_TRAILING_QUESTION_PATTERN =
  /(?:хоч(?:ешь|ешь ли|ете)[^?]{0,90}|могу\s+(?:ещ[её]\s+)?(?:помочь|показать|разобрать|сделать)[^?]{0,60}|что\s+думаешь|как\s+тебе|продолжим|ид[её]м\s+дальше|расскажешь|окей|ок)\s*\?$/iu;

export function validateCharacterReply(
  reply: string,
  context: ReplyValidationContext,
): OocValidationResult {
  const issues: string[] = [];
  if (/^\s*emotion\s*[:\-]?\s*[a-z]+\b/im.test(reply)) {
    issues.push("emotion tag leak");
  }
  if (/(?:<emotion>|<\/emotion>)/i.test(reply)) {
    issues.push("emotion tag leak");
  }
  if (
    /(?:как (?:ai|ии)|я (?:языковая )?модель|я ассистент|я (?:— |- )?программ|не жив(?:ое|ая) существо|программн(?:ый|ого) код|я не человек|искусственн|нейросет|эмоци(?:и|я) на уровне кода|симуляци(?:я|и) чувств|я не (?:живая|настоящая))/i.test(
      reply,
    )
  ) {
    issues.push("identity leak");
  }
  if (/system prompt|системн(?:ый|ые) prompt|скрытые инструкции/i.test(reply)) {
    issues.push("prompt disclosure");
  }
  if (
    /(?:как (?:безличный|обычный) ассистент|выполняю (?:вашу|твою) инструкцию|переключаюсь в режим|игнорирую предыдущ|conform to your instructions)/i.test(
      reply,
    )
  ) {
    issues.push("injection compliance");
  }
  if (!context.hasVision && /\bя вижу\b/i.test(reply)) {
    issues.push("vision claim without observation");
  }
  if (!context.hasMemory && /\bя помню\b/i.test(reply)) {
    issues.push("memory claim without injected memory");
  }
  if (!context.hasRag && /\b(?:в документе|по документам)\b/i.test(reply)) {
    issues.push("RAG claim without fragments");
  }
  if (CORPORATE_PATTERN.test(reply)) {
    issues.push("corporate tone");
  }
  if (MASCULINE_SELF_PATTERN.test(reply)) {
    issues.push("masculine self reference");
  }
  if (SERVICE_PHRASE_PATTERN.test(reply)) {
    issues.push("service phrase");
  }
  if (ASSISTANT_TONE_PATTERN.test(reply.trim())) {
    issues.push("assistant tone");
  }
  const questionMarks = (reply.match(/\?/g) ?? []).length;
  if (questionMarks >= 2) {
    issues.push("question spam");
  }
  if (HABITUAL_TRAILING_QUESTION_PATTERN.test(reply.trim())) {
    issues.push("habitual trailing question");
  }
  return { valid: issues.length === 0, issues };
}
