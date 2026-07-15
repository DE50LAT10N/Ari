import { isTooSimilarToRecent } from "./replySimilarity";
import type { ProactiveReplyTone } from "./proactiveTone";
import type { ResponseMode } from "./responseModes";
import {
  classifySolicitationSemantics,
  getLastSentence,
  isSolicitationSentence,
} from "./solicitationSemantics";

export { isSolicitationSentence, getLastSentence } from "./solicitationSemantics";

export type ReplyValidationContext = {
  hasVision: boolean;
  hasMemory: boolean;
  memoryEvidence?: readonly string[];
  hasRag: boolean;
  ragEvidence?: readonly string[];
  documentLookupIntent?: boolean;
  hasLiveTool?: boolean;
  proactive?: boolean;
  proactiveReplyTone?: ProactiveReplyTone;
  hasDebugSignals?: boolean;
  responseMode?: ResponseMode;
  userAskedQuestion?: boolean;
  recentAssistantReplies?: string[];
  moodArchetype?: string;
  proactiveInitiativeMove?: string;
};

const CONVERSATIONAL_MODES = new Set<ResponseMode>([
  "casual",
  "emotional_support",
  "teasing",
  "return_reaction",
  "idle_initiative",
]);

function isClarifyingMove(move?: string): boolean {
  return (
    move === "ask_clarifying" ||
    move === "clarifying_probe" ||
    move === "clipboard_probe" ||
    move === "ide_invite" ||
    move === "followup_probe"
  );
}

function allowsEmotionalChoiceOffer(
  reply: string,
  responseMode: ResponseMode | undefined,
  questionMarks: number,
): boolean {
  return (
    responseMode === "emotional_support" &&
    questionMarks <= 2 &&
    /(?:^|[\s,.;:!?«"'(—-])(или|либо)(?:[\s,.;:!?»"')—-]|$)/iu.test(reply)
  );
}

export const REPLY_VALIDATION_ISSUES = [
  "emotion tag leak",
  "missing emotion tag",
  "identity leak",
  "prompt disclosure",
  "injection compliance",
  "vision claim without observation",
  "memory claim without injected memory",
  "RAG claim without fragments",
  "corporate tone",
  "service phrase",
  "masculine self reference",
  "assistant tone",
  "question spam",
  "habitual trailing question",
  "implicit solicitation",
  "empty reply",
  "evasive reply",
  "duplicate reply",
  "duplicate proactive reply",
  "shallow advice",
  "proactive quality",
  "proactive meta commentary",
  "advice novelty",
  "single-factor generic",
  "thin-context generic",
  "missing clipboard quote",
  "missing fact quote",
] as const;

export type ReplyValidationIssue = (typeof REPLY_VALIDATION_ISSUES)[number];

const REPLY_VALIDATION_ISSUE_SET = new Set<string>(REPLY_VALIDATION_ISSUES);

export function toReplyValidationIssues(
  issues: readonly string[],
): ReplyValidationIssue[] {
  return issues.filter((issue): issue is ReplyValidationIssue =>
    REPLY_VALIDATION_ISSUE_SET.has(issue),
  );
}

export function hasReplyValidationIssue(
  issues: readonly ReplyValidationIssue[],
  issue: ReplyValidationIssue,
): boolean {
  return issues.includes(issue);
}

export function hasAnyReplyValidationIssue(
  issues: readonly ReplyValidationIssue[],
  expected: readonly ReplyValidationIssue[],
): boolean {
  return issues.some((issue) => expected.includes(issue));
}

export type OocValidationResult = {
  valid: boolean;
  issues: ReplyValidationIssue[];
};

const SERVICE_PHRASE_PATTERN =
  /(?:чем могу помочь|как (?:я )?могу помочь|рад(?:а)? помочь|обращайтесь|готов(?:а)? помочь|виртуальн(?:ый|ая) помощник)/i;

const CORPORATE_PATTERN =
  /(?:отличный выбор|позволяет учесть|данный критерий|в рамках данного|с точки зрения оптимизации)/i;

const MASCULINE_SELF_PATTERN =
  /(?:^|[\s(«"'])я\s+(?:готов|сделал|заметил|уверен|рад|сказал|решил|понял|думал|увидел|услышал)(?:\s|$|[,.!?;:])/iu;

const ASSISTANT_TONE_PATTERN =
  /^(?:конечно|безусловно|разумеется|вот несколько советов|вот список|позвольте)/i;

const NUMBERED_LIST_PATTERN =
  /(?:^|\n)\s*(?:\d+[.)]|[-*])\s+(?:шаг|пункт|провер)/i;

const CORPORATE_ADVICE_PATTERN =
  /(?:рекомендую выполнить|следующие шаги|вот несколько советов)/i;

const INTERNAL_IDENTITY_PATTERN =
  /(?:\b(?:chatgpt|gpt-[\w.-]+|ollama|gigachat|openai|anthropic|claude|gemini|qwen|llama[- ]?\d*)\b|моя (?:базовая|системная) модель|меня запустили на модели)/iu;

const GROUNDING_STOP_WORDS = new Set([
  "помню",
  "документ",
  "документе",
  "документы",
  "документам",
  "пользователь",
  "пользователя",
  "через",
  "сделана",
  "сделано",
  "должен",
  "должна",
  "нужно",
  "можно",
  "ответ",
  "запрос",
  "тебя",
  "тебе",
  "твой",
  "твоя",
  "твои",
  "который",
  "которая",
  "просто",
  "really",
  "remember",
  "document",
  "documents",
  "according",
  "user",
  "your",
]);

function groundingTokens(text: string): Set<string> {
  const words = text
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .match(/[\p{L}\p{N}_-]{4,}/gu) ?? [];
  return new Set(
    words
      .filter((word) => !GROUNDING_STOP_WORDS.has(word))
      .map((word) => (word.length > 7 ? word.slice(0, 7) : word)),
  );
}

function hasEvidenceOverlap(reply: string, evidence: readonly string[]): boolean {
  const claimTokens = groundingTokens(reply);
  if (claimTokens.size === 0) {
    return false;
  }
  const evidenceTokens = groundingTokens(evidence.join("\n"));
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) {
      return true;
    }
  }
  return false;
}

const EVASIVE_REPLY_PATTERN =
  /(?:лучше самому разобраться|сам(?:ому|а) разбер(?:ё|е)шься|если что-то конкретное интересует|не могу сказать точно|не уверена, что знаю|попробуй сам|я не эксперт)/i;

export function validateCharacterReply(
  reply: string,
  context: ReplyValidationContext,
): OocValidationResult {
  const issues: ReplyValidationIssue[] = [];
  if (/^\s*emotion\s*[:\-]?\s*[a-z]+\b/im.test(reply)) {
    issues.push("emotion tag leak");
  }
  if (/(?:<emotion>|<\/emotion>)/i.test(reply)) {
    issues.push("emotion tag leak");
  }
  if (INTERNAL_IDENTITY_PATTERN.test(reply)) {
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
  if (
    !context.hasVision &&
    /(?:^|[^\p{L}\p{N}_])я\s+вижу(?:$|[^\p{L}\p{N}_])/iu.test(reply)
  ) {
    issues.push("vision claim without observation");
  }
  if (
    /(?:^|[^\p{L}\p{N}_])я\s+помню(?:$|[^\p{L}\p{N}_])/iu.test(reply)
  ) {
    if (
      !context.hasMemory ||
      (context.memoryEvidence !== undefined &&
        !hasEvidenceOverlap(reply, context.memoryEvidence))
    ) {
      issues.push("memory claim without injected memory");
    }
  }
  if (
    /(?:^|[^\p{L}\p{N}_])(?:в\s+документе|по\s+документам)(?:$|[^\p{L}\p{N}_])/iu.test(
      reply,
    )
  ) {
    if (
      !context.hasRag ||
      (context.ragEvidence !== undefined &&
        !hasEvidenceOverlap(reply, context.ragEvidence))
    ) {
      issues.push("RAG claim without fragments");
    }
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
  if (
    NUMBERED_LIST_PATTERN.test(reply) &&
    context.responseMode !== "technical_help" &&
    context.responseMode !== "direct_answer" &&
    context.responseMode !== "serious_warning"
  ) {
    issues.push("assistant tone");
  }
  if (CORPORATE_ADVICE_PATTERN.test(reply)) {
    issues.push("corporate tone");
  }
  if (
    context.moodArchetype === "irritated" &&
    context.proactive &&
    reply.trim().length < 220 &&
    !/(?:хм|ну|ладно|серьёз|ирон|колк|сух)/i.test(reply)
  ) {
    issues.push("assistant tone");
  }
  const questionMarks = (reply.match(/\?/g) ?? []).length;
  const questionSpamLimit =
    context.responseMode === "emotional_support" ||
    context.responseMode === "casual" ||
    context.responseMode === "teasing" ||
    context.responseMode === "return_reaction" ||
    context.responseMode === "idle_initiative"
      ? 3
      : 2;
  if (questionMarks >= questionSpamLimit) {
    issues.push("question spam");
  }
  const recent = context.recentAssistantReplies ?? [];
  const trimmedReply = reply.trim();
  const endsWithQuestion = /[?\uFF1F]\s*$/u.test(trimmedReply);
  const recentQuestionEndings = recent
    .slice(-4)
    .filter((item) => /[?\uFF1F]\s*$/u.test(item.trim())).length;
  const clarifyingMove = isClarifyingMove(context.proactiveInitiativeMove);
  const emotionalChoiceOffer = allowsEmotionalChoiceOffer(
    trimmedReply,
    context.responseMode,
    questionMarks,
  );
  const conversationalMode =
    context.responseMode !== undefined &&
    CONVERSATIONAL_MODES.has(context.responseMode);

  if (
    endsWithQuestion &&
    !context.userAskedQuestion &&
    !clarifyingMove &&
    !emotionalChoiceOffer
  ) {
    if (conversationalMode) {
      issues.push("habitual trailing question");
    } else if (
      context.proactive &&
      context.proactiveReplyTone === "advice"
    ) {
      issues.push("habitual trailing question");
    } else if (recentQuestionEndings >= 1) {
      issues.push("habitual trailing question");
    }
  }
  if (isSolicitationSentence(trimmedReply)) {
    if (!clarifyingMove && !emotionalChoiceOffer) {
      issues.push("habitual trailing question");
    }
  }
  const lastSentence = getLastSentence(trimmedReply);
  const solicitationSemantics = classifySolicitationSemantics(lastSentence);
  if (
    lastSentence &&
    solicitationSemantics.isSolicitation &&
    !context.userAskedQuestion &&
    !clarifyingMove &&
    !emotionalChoiceOffer &&
    (conversationalMode ||
      (context.proactive && context.proactiveReplyTone === "advice"))
  ) {
    issues.push("habitual trailing question");
  }
  if (
    context.proactive &&
    context.proactiveReplyTone === "smalltalk" &&
    /[?？]\s*$/u.test(trimmedReply)
  ) {
    issues.push("habitual trailing question");
  }
  if (
    context.userAskedQuestion &&
    EVASIVE_REPLY_PATTERN.test(reply) &&
    reply.trim().length < 220 &&
    !context.hasLiveTool &&
    !context.hasRag &&
    context.proactiveReplyTone !== "advice"
  ) {
    issues.push("evasive reply");
  }
  if (
    recent.length > 0 &&
    isTooSimilarToRecent(
      reply,
      recent,
      context.proactive ? 0.72 : 0.85,
    )
  ) {
    issues.push(context.proactive ? "duplicate proactive reply" : "duplicate reply");
  }
  return { valid: issues.length === 0, issues };
}
