import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import { isLiteLlmModel } from "../llm/modelRouter";
import { redactAndTruncate } from "../platform/secretRedaction";
import { hashStringDjb2 } from "../platform/hashUtils";
import {
  clipboardPrimaryAnchors,
  describeClipboardSemantics,
  isClipboardSemanticallyRich,
} from "../platform/clipboardSemantics";
import { pruneWorkingMemory } from "../memory/workingMemory";
import { formatGoalLedgerForPrompt } from "../tasks/goalLedger";
import type { AdviceUrgency } from "./adviceUrgency";
import type { InitiativeSignalBundle } from "./initiativeContext";
import {
  inferInitiativeMoves,
  type ProactiveInitiativeMove,
  type ProactiveMoveHint,
} from "./proactiveInitiativePlaybook";
import {
  formatAdviceCandidateForPrompt,
  type AdviceCandidate,
} from "./advicePlanner";
import { evaluateAdviceNovelty } from "./adviceNovelty";
import {
  VN_CHARACTER_RULE,
  PROACTIVE_CHARACTER_RULE,
} from "./proactiveLiveliness";
import {
  buildFactLinkGraph,
  inferTopicChains,
  type ProactiveTopicChain,
  type ProactiveTopicLink,
} from "./proactiveTopicLinker";
import type { ProactiveReplyTone } from "./proactiveTone";
import {
  buildAdvisorHypotheses,
  describeAdvisorHypotheses,
} from "./advisorHypotheses";
import {
  hasLiveWorkAnchor,
  textMatchesLiveWorkContext,
} from "./advisorEngine";
import { deriveScreenState, describeScreenState } from "./screenState";
import {
  getLastSentence,
  isSolicitationSentence,
} from "./solicitationSemantics";

export type { ProactiveInitiativeMove, ProactiveMoveHint, ProactiveTopicLink, ProactiveTopicChain };

export type ProactiveSignalFactKind =
  | "file"
  | "clipboard"
  | "chat"
  | "task"
  | "query"
  | "code"
  | "reference"
  | "wm"
  | "urgency"
  | "goal"
  | "session"
  | "screen"
  | "hypothesis";

export type ProactiveSignalFact = {
  id: string;
  kind: ProactiveSignalFactKind;
  label: string;
  detail: string;
};

export type ProactiveLlmBundle = {
  tone: ProactiveReplyTone;
  linkedThemes: string[];
  mergedAnchor: string;
  narrativeBrief: string;
  practicalHook?: string;
  adviceSteps?: string[];
  usefulnessScore: number;
  shouldSend: boolean;
  rejectReason?: string;
  overlapsBanned: boolean;
  source: "llm" | "rejected";
  initiativeMove?: ProactiveInitiativeMove;
  groundFactIds?: string[];
  topicLinks?: ProactiveTopicLink[];
  primaryChainSummary?: string;
  linkConfidence?: number;
  selectedAdviceCandidate?: AdviceCandidate;
};

type ProactiveLlmSystemRejectReason =
  | "llm offline"
  | "llm synthesis failed"
  | "llm synthesis rejected"
  | "llm synthesis overlaps banned"
  | "llm synthesis low usefulness";

export type ProactiveLlmInput = {
  bundle: InitiativeSignalBundle;
  tone: ProactiveReplyTone;
  bannedTopics?: string[];
  candidateTopics?: string[];
  sessionMinutes?: number;
  windowMinutes?: number;
  companionSilenceMs?: number;
  recentUserMessage?: string;
  urgency?: AdviceUrgency;
  recentChatTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  llmOnline?: boolean;
  requirePracticalHook?: boolean;
  moveHints?: ProactiveMoveHint[];
  ragSnippets?: string[];
  codeExcerpts?: Array<{ file: string; text: string }>;
  topicChains?: ProactiveTopicChain[];
  topicLinks?: ProactiveTopicLink[];
  adviceCandidate?: AdviceCandidate | null;
  adviceMoveGuidance?: string;
};

type BundleResponse = {
  tone?: unknown;
  linkedThemes?: unknown;
  mergedAnchor?: unknown;
  narrativeBrief?: unknown;
  practicalHook?: unknown;
  adviceSteps?: unknown;
  usefulnessScore?: unknown;
  shouldSend?: unknown;
  rejectReason?: unknown;
  overlapsBanned?: unknown;
  initiativeMove?: unknown;
  groundFactIds?: unknown;
  topicLinks?: unknown;
  primaryChainSummary?: unknown;
  linkConfidence?: unknown;
};

type QualityResponse = {
  acceptable?: unknown;
  reason?: unknown;
  issues?: unknown;
};

const CACHE_TTL_MS = 4 * 60_000;
const USEFULNESS_MIN = 0.45;
const bundleCache = new Map<string, { at: number; value: ProactiveLlmBundle }>();

let lastBundleSnapshot: ProactiveLlmBundle | null = null;
let lastRejectedSnapshot: ProactiveLlmBundle | null = null;
let lastFactsSnapshot: ProactiveSignalFact[] = [];

export function getLastProactiveSignalFacts(): ProactiveSignalFact[] {
  return lastFactsSnapshot;
}

function stripEmotionTags(text: string): string {
  return text.replace(/<emotion>[^<]+<\/emotion>/gi, "").trim();
}

function canUseBacklogFact(
  text: string | undefined,
  bundle: InitiativeSignalBundle,
): boolean {
  if (!hasLiveWorkAnchor(bundle)) {
    return true;
  }
  return textMatchesLiveWorkContext(text, bundle);
}

function describeRelevantScreenState(
  state: ReturnType<typeof deriveScreenState>,
  bundle: InitiativeSignalBundle,
): string {
  if (!hasLiveWorkAnchor(bundle)) {
    return describeScreenState(state);
  }
  return [
    `app=${state.app}`,
    state.visibleCodeContext?.file ? `file=${state.visibleCodeContext.file}` : "",
    state.visibleProblem ? `problem=${state.visibleProblem}` : "",
    `confidence=${state.confidence.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function factFingerprint(
  facts: ProactiveSignalFact[],
  tone: ProactiveReplyTone,
  banned: string[],
  adviceCandidate?: AdviceCandidate | null,
): string {
  return [
    tone,
    facts.map((fact) => fact.id).join("|"),
    banned.slice(0, 5).join("|"),
    adviceCandidate?.id ?? "",
  ].join("::");
}

export function resetProactiveLlmCacheForTests(): void {
  bundleCache.clear();
  lastBundleSnapshot = null;
  lastRejectedSnapshot = null;
  lastFactsSnapshot = [];
}

export function getLastProactiveLlmBundle(): ProactiveLlmBundle | null {
  return lastBundleSnapshot;
}

export function getLastProactiveSynthesisReject(): ProactiveLlmBundle | null {
  return lastRejectedSnapshot;
}

function isFailedSynthesisBundle(bundle: ProactiveLlmBundle): boolean {
  if (bundle.source === "rejected") {
    return true;
  }
  return !bundle.shouldSend;
}

export function setLastProactiveLlmBundle(
  bundle: ProactiveLlmBundle,
  facts?: ProactiveSignalFact[],
): void {
  lastBundleSnapshot = bundle;
  if (facts?.length) {
    lastFactsSnapshot = facts;
  }
}

function rememberProactiveLlmBundle(
  bundle: ProactiveLlmBundle,
  facts: ProactiveSignalFact[],
): ProactiveLlmBundle {
  if (isFailedSynthesisBundle(bundle)) {
    lastRejectedSnapshot =
      bundle.source === "rejected"
        ? bundle
        : { ...bundle, source: "rejected" };
    return bundle;
  }
  setLastProactiveLlmBundle(bundle, facts);
  return bundle;
}

function createRejectedProactiveLlmBundle(
  tone: ProactiveReplyTone,
  reason: ProactiveLlmSystemRejectReason,
): ProactiveLlmBundle {
  return {
    tone,
    linkedThemes: [],
    mergedAnchor: "",
    narrativeBrief: "",
    usefulnessScore: 0,
    shouldSend: false,
    rejectReason: reason,
    overlapsBanned: false,
    source: "rejected",
  };
}

function isSubstantiveClipboardFact(
  fact?: ProactiveSignalFact | null,
): fact is ProactiveSignalFact {
  return Boolean(
    fact?.kind === "clipboard" &&
      (isClipboardSemanticallyRich(fact.detail) ||
        /error|exception|warning|failed|cannot|denied|not found|traceback|panic|function|const|class|import|def |https?:\/\/|www\.|\u043e\u0448\u0438\u0431|\u043f\u0440\u0435\u0434\u0443\u043f\u0440\u0435\u0436\u0434|\u0434\u0438\u0430\u0433\u043d\u043e\u0441\u0442/i.test(
        fact.detail,
      )),
  );
}

function buildClipboardFallbackCandidate(
  clip: ProactiveSignalFact,
  file?: ProactiveSignalFact,
): AdviceCandidate {
  const quote = clip.detail.slice(0, 180);
  const isUrl = /https?:\/\/|www\./i.test(clip.detail);
  const semantics = describeClipboardSemantics(clip.detail);
  const semanticInstruction = semantics
    ? ` Используй элементы из буфера как якорь: ${semantics}.`
    : "";
  const actionText = file
    ? `Разбери буфер «${quote}» как свежую подсказку к ${file.detail}.${semanticInstruction} Дай гипотезу по связи этих элементов, один ближайший fix/шаг и короткую проверку результата. Не уходи в общий комментарий по файлу и не задавай уточняющий вопрос.`
    : `Разбери буфер «${quote}».${semanticInstruction} Дай гипотезу по связи этих элементов, один ближайший fix/шаг и короткую проверку результата. Не задавай уточняющий вопрос.`;
  return {
    id: "clipboard-fallback",
    kind: isUrl ? "docs_lookup" : "debug_next_step",
    evidenceIds: [clip.id, file?.id].filter(Boolean) as string[],
    actionText,
    expectedUtility: 0.82,
    interruptionCost: 0.18,
    confidence: 0.72,
    reason: "содержательный буфер дает достаточно фактов для конкретного совета",
    score: 0.72,
  };
}

export function buildAdviceFallbackBundle(
  input: ProactiveLlmInput,
  facts: ProactiveSignalFact[],
  reason: ProactiveLlmSystemRejectReason | string,
): ProactiveLlmBundle | null {
  if (input.tone !== "advice") {
    return null;
  }
  const candidate = input.adviceCandidate ?? null;
  const clipboardFact = facts.find((fact) => fact.kind === "clipboard");
  const fileFact = facts.find((fact) => fact.kind === "file");
  const fallbackCandidate =
    !candidate && isSubstantiveClipboardFact(clipboardFact)
      ? buildClipboardFallbackCandidate(clipboardFact, fileFact)
      : null;
  const effectiveCandidate = candidate ?? fallbackCandidate;
  const groundingFacts = facts.filter((fact) =>
    ["file", "clipboard", "task", "query", "reference", "urgency", "screen", "hypothesis", "wm"].includes(
      fact.kind,
    ),
  );
  if (!candidate && groundingFacts.length === 0) {
    return null;
  }

  const primaryFact = clipboardFact ?? groundingFacts[0];
  const evidenceIds = effectiveCandidate?.evidenceIds.length
    ? effectiveCandidate.evidenceIds
    : groundingFacts.slice(0, 3).map((fact) => fact.id);
  const actionText =
    effectiveCandidate?.actionText ??
    (primaryFact
      ? `Сделай один следующий шаг от факта: ${primaryFact.detail}`
      : "Сделай один следующий шаг по текущему рабочему контексту.");
  const anchor =
    input.candidateTopics?.[0] ??
    effectiveCandidate?.kind ??
    primaryFact?.detail.slice(0, 80) ??
    "текущий рабочий контекст";
  const linkedThemes = [
    effectiveCandidate?.kind,
    ...groundingFacts.map((fact) => fact.detail.slice(0, 60)),
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .slice(0, 2);

  return {
    tone: "advice",
    linkedThemes,
    mergedAnchor: anchor.slice(0, 180),
    narrativeBrief: effectiveCandidate
      ? `Planner выбрал ${effectiveCandidate.kind}: ${effectiveCandidate.reason}`
      : `Совет опирается на текущие факты: ${groundingFacts
          .slice(0, 2)
          .map((fact) => fact.label)
          .join(", ")}`,
    practicalHook: actionText.slice(0, 220),
    adviceSteps: [actionText.slice(0, 180)],
    usefulnessScore: Math.max(0.62, effectiveCandidate?.expectedUtility ?? 0.62),
    shouldSend: true,
    rejectReason: `fallback after ${reason}`,
    overlapsBanned: false,
    source: "llm",
    initiativeMove: "concrete_step",
    groundFactIds: evidenceIds,
    primaryChainSummary: effectiveCandidate
      ? `${effectiveCandidate.reason}: ${actionText.slice(0, 160)}`
      : actionText.slice(0, 200),
    linkConfidence: effectiveCandidate?.confidence ?? 0.58,
    selectedAdviceCandidate: effectiveCandidate ?? undefined,
  };
}

export function buildClarifyingProbeBundle(
  input: ProactiveLlmInput,
  facts: ProactiveSignalFact[],
  reason: ProactiveLlmSystemRejectReason | string,
): ProactiveLlmBundle | null {
  if (input.tone !== "advice") {
    return null;
  }

  const clip = facts.find((fact) => fact.kind === "clipboard");
  const file = facts.find((fact) => fact.kind === "file");
  const query = facts.find((fact) => fact.kind === "query");
  const screen = facts.find((fact) => fact.kind === "screen");
  const wm = facts.find((fact) => fact.kind === "wm");
  const probeFact = clip ?? file ?? query ?? screen ?? wm;
  if (!probeFact) {
    return null;
  }

  let initiativeMove: ProactiveInitiativeMove = "context_fact";
  let practicalHook: string;
  if (clip) {
    initiativeMove = "clipboard_probe";
    const quote = clip.detail.slice(0, 140);
    const substantive = isSubstantiveClipboardFact(clip);
    practicalHook = substantive
      ? `В буфере «${quote}». Первый ход: выдели ключевую ошибку или символ, свяжи её с ближайшим файлом/последним изменением и проверь одну гипотезу, а не перезапускай всё подряд.`
      : `В буфере «${quote}» — это текущая отладка или просто пример? Уточни, и я дам точный следующий шаг.`;
  } else if (file) {
    initiativeMove = "ide_invite";
    practicalHook = buildFileClarifyingQuestion(file.detail);
  } else if (query) {
    practicalHook = `Ты искал «${query.detail.slice(0, 80)}» — это связано с тем, что делаешь в IDE сейчас, или отдельная задача?`;
  } else if (screen) {
    practicalHook = `На экране вижу «${probeFact.detail.slice(0, 80)}» — что из этого сейчас главная цель?`;
  } else {
    practicalHook = `По недавней активности «${probeFact.detail.slice(0, 80)}» — какой результат ты хочешь получить сейчас?`;
  }

  const candidate: AdviceCandidate = {
    id: "clarifying-probe-fallback",
    kind: "clarifying_probe",
    evidenceIds: [probeFact.id],
    actionText: practicalHook.slice(0, 180),
    expectedUtility: 0.58,
    interruptionCost: 0.1,
    confidence: 0.6,
    reason: "недостаточно контекста для многофакторного совета",
    score: 0.6,
  };

  return {
    tone: "advice",
    linkedThemes: [probeFact.label],
    mergedAnchor: probeFact.detail.slice(0, 120),
    narrativeBrief: `Нужно уточнение по ${probeFact.label}, чтобы связать цель и ситуацию в конкретный совет.`,
    practicalHook: practicalHook.slice(0, 220),
    adviceSteps: [],
    usefulnessScore: 0.58,
    shouldSend: true,
    rejectReason: `clarifying probe after ${reason}`,
    overlapsBanned: false,
    source: "llm",
    initiativeMove,
    groundFactIds: [probeFact.id],
    primaryChainSummary: `${probeFact.label} — контекста недостаточно для конкретного многофакторного совета`,
    linkConfidence: 0.55,
    selectedAdviceCandidate: candidate,
  };
}

export function tryAdviceFallbackChain(
  input: ProactiveLlmInput,
  facts: ProactiveSignalFact[],
  reason: ProactiveLlmSystemRejectReason | string,
): ProactiveLlmBundle | null {
  const candidate = input.adviceCandidate;
  const thinContext = isThinAdviceContext(facts);
  const substantiveClipboard = facts.some((fact) =>
    isSubstantiveClipboardFact(fact),
  );
  const substantivePlanner =
    candidate &&
    candidate.kind !== "clarifying_probe" &&
    candidate.kind !== "uncertainty_probe" &&
    !/сделай один следующий шаг от факта/i.test(candidate.actionText);

  if (substantiveClipboard && !substantivePlanner) {
    const fallback = buildAdviceFallbackBundle(input, facts, reason);
    if (fallback) {
      return fallback;
    }
  }

  if (thinContext && !substantivePlanner && !substantiveClipboard) {
    const clarifying = buildClarifyingProbeBundle(input, facts, reason);
    if (clarifying) {
      return clarifying;
    }
  }

  if (
    candidate &&
    candidate.kind !== "clarifying_probe" &&
    candidate.kind !== "uncertainty_probe"
  ) {
    return buildAdviceFallbackBundle(input, facts, reason);
  }
  return (
    buildClarifyingProbeBundle(input, facts, reason) ??
    buildAdviceFallbackBundle(input, facts, reason)
  );
}

export function collectProactiveSignalFacts(
  input: ProactiveLlmInput,
): ProactiveSignalFact[] {
  const { bundle } = input;
  const facts: ProactiveSignalFact[] = [];
  const push = (
    kind: ProactiveSignalFactKind,
    id: string,
    label: string,
    detail: string,
  ) => {
    const trimmed = detail.trim();
    if (!trimmed) {
      return;
    }
    const maxLength =
      kind === "clipboard" ? 320 : kind === "reference" ? 260 : 200;
    facts.push({ id, kind, label, detail: trimmed.slice(0, maxLength) });
  };

  if (bundle.editorFile) {
    push("file", `file:${bundle.editorFile}`, "Файл в IDE", bundle.editorFile);
  }

  if (input.codeExcerpts?.length) {
    const excerpt = input.codeExcerpts[0];
    push(
      "code",
      `code:${excerpt.file}`,
      "Фрагмент кода (реальный файл)",
      redactAndTruncate(excerpt.text, 200),
    );
  }

  const recentClips = bundle.clipboardSnippets.slice(-3);
  for (let index = 0; index < recentClips.length; index++) {
    const clip = recentClips[index];
    const suffix =
      recentClips.length > 1 ? `:${index}` : "";
    push(
      "clipboard",
      `clip:${clip.kind}${suffix}`,
      `Буфер (${clip.kind})`,
      redactAndTruncate(clip.text, 320),
    );
  }

  const recentUser =
    input.recentUserMessage?.trim() ||
    [...(input.recentChatTurns ?? [])]
      .reverse()
      .find((turn) => turn.role === "user")
      ?.content;
  if (
    recentUser &&
    (canUseBacklogFact(recentUser, bundle) || bundle.clipboardSnippets.length > 0)
  ) {
    push(
      "chat",
      "chat:last-user",
      "Последний вопрос",
      stripEmotionTags(recentUser).slice(0, 120),
    );
  }

  if (bundle.nextTaskTitle && canUseBacklogFact(bundle.nextTaskTitle, bundle)) {
    push("task", "task:next", "Открытая задача", bundle.nextTaskTitle);
  }
  if (bundle.taskActivityLink?.taskTitle) {
    push(
      "task",
      `task:link:${bundle.taskActivityLink.taskTitle}`,
      "Связь с задачей",
      bundle.taskActivityLink.taskTitle,
    );
  }

  for (const theme of bundle.advisor.topQueryThemes.slice(0, 3)) {
    if (!canUseBacklogFact(theme, bundle)) {
      continue;
    }
    push("query", `query:${theme}`, "Тема поиска", theme);
  }
  for (const entry of bundle.advisor.activitySummary.recentSignals
    .filter((signal) => signal.kind === "query_topic")
    .slice(-2)) {
    if (!canUseBacklogFact(entry.topic, bundle)) {
      continue;
    }
    push(
      "query",
      `query:${entry.topic}`,
      `Запрос (${entry.source ?? "app"})`,
      entry.topic,
    );
  }

  for (const entry of pruneWorkingMemory(bundle.advisor.now).slice(-4)) {
    if (
      !canUseBacklogFact(
        [entry.topic, entry.app, entry.title].filter(Boolean).join(" "),
        bundle,
      )
    ) {
      continue;
    }
    push(
      "wm",
      `wm:${entry.id}`,
      entry.kind,
      [entry.topic, entry.app, entry.title].filter(Boolean).join(" — "),
    );
  }

  const screenState = deriveScreenState(bundle);
  if (screenState.confidence >= 0.45) {
    push(
      "screen",
      "screen:state",
      "Состояние экрана",
      describeRelevantScreenState(screenState, bundle),
    );
  }

  for (let index = 0; index < (input.ragSnippets ?? []).length; index += 1) {
    const snippet = input.ragSnippets?.[index];
    if (!snippet?.trim()) {
      continue;
    }
    push(
      "reference",
      `reference:${index}`,
      "RAG / web reference",
      redactAndTruncate(snippet, 260),
    );
  }

  const hypotheses = buildAdvisorHypotheses(bundle, facts);
  const relevantHypotheses = hasLiveWorkAnchor(bundle)
    ? hypotheses.filter((hypothesis) => hypothesis.kind !== "uncertain")
    : hypotheses;
  const hypothesisSummary = describeAdvisorHypotheses(relevantHypotheses);
  if (hypothesisSummary && canUseBacklogFact(hypothesisSummary, bundle)) {
    push(
      "hypothesis",
      `hypothesis:${hypotheses[0]?.kind ?? "unknown"}`,
      "Вывод советчика",
      hypothesisSummary,
    );
  }

  if (bundle.advisor.activitySummary.inputFrictionScore >= 1) {
    const friction = bundle.advisor.activitySummary;
    push(
      "hypothesis",
      "hypothesis:input-friction",
      "Паттерн застревания",
      `input friction ${friction.inputFrictionScore.toFixed(1)}: паузы ${friction.recentInputPauses}, возвраты ${friction.recentInputReturns}, набор ${friction.recentKeyboardBursts}, исправления ${friction.recentCorrectionChurns}, команды ${friction.recentCommandLoops}; вероятно, нужен ответ до поиска`,
    );
  }

  if (input.urgency && input.urgency.level !== "none") {
    push(
      "urgency",
      `urgency:${input.urgency.level}`,
      "Срочность совета",
      `${input.urgency.level} (${input.urgency.score}): ${input.urgency.reasons.join("; ")}`,
    );
  }

  const goals = formatGoalLedgerForPrompt(2);
  if (goals && canUseBacklogFact(goals, bundle)) {
    push("goal", "goal:ledger", "Цели", goals.replace(/\n/g, " | "));
  }

  const sessionMinutes =
    input.sessionMinutes ?? bundle.advisor.sessionMinutes;
  const windowMinutes = input.windowMinutes ?? bundle.advisor.windowMinutes;
  if (sessionMinutes > 0 || windowMinutes > 0 || input.companionSilenceMs) {
    const silenceMin =
      input.companionSilenceMs !== undefined
        ? Math.max(1, Math.round(input.companionSilenceMs / 60_000))
        : 0;
    push(
      "session",
      "session:timing",
      "Сессия",
      [
        sessionMinutes > 0 ? `работа ~${sessionMinutes} мин` : "",
        windowMinutes > 0 ? `окно ~${windowMinutes} мин` : "",
        silenceMin > 0 ? `тишина с Ari ~${silenceMin} мин` : "",
      ]
        .filter(Boolean)
        .join(", "),
    );
  }

  return facts;
}

function factDetailTokens(fact: ProactiveSignalFact): string[] {
  return fact.detail
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
}

function textMentionsFact(text: string, fact: ProactiveSignalFact): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(fact.detail.slice(0, 20).toLowerCase())) {
    return true;
  }
  return factDetailTokens(fact).some((token) => lower.includes(token));
}

function hookGroundedInFacts(
  hook: string | undefined,
  factIds: string[],
  facts: ProactiveSignalFact[],
): boolean {
  if (!hook?.trim()) {
    return false;
  }
  const grounded = facts.filter((fact) => factIds.includes(fact.id));
  if (!grounded.length) {
    return grounded.length === 0;
  }
  return grounded.some((fact) => textMentionsFact(hook, fact));
}

function narrativeGroundedInChain(
  narrative: string,
  chain: ProactiveTopicChain | undefined,
  facts: ProactiveSignalFact[],
): boolean {
  if (!chain || chain.links.length === 0) {
    return true;
  }
  const ids = new Set<string>();
  for (const link of chain.links) {
    ids.add(link.fromFactId);
    ids.add(link.toFactId);
  }
  const chainFacts = facts.filter((fact) => ids.has(fact.id));
  if (chainFacts.length < 2) {
    return true;
  }
  const mentioned = chainFacts.filter((fact) => textMentionsFact(narrative, fact));
  return mentioned.length >= 2;
}

function parseTopicLinks(value: unknown, facts: ProactiveSignalFact[]): ProactiveTopicLink[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const factIds = new Set(facts.map((fact) => fact.id));
  const links = value
    .map((item): ProactiveTopicLink | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      const fromFactId = typeof row.fromFactId === "string" ? row.fromFactId : "";
      const toFactId = typeof row.toFactId === "string" ? row.toFactId : "";
      const relation = row.relation;
      if (!fromFactId || !toFactId || !factIds.has(fromFactId) || !factIds.has(toFactId)) {
        return null;
      }
      if (
        relation !== "same_file" &&
        relation !== "answers_question" &&
        relation !== "blocks_task" &&
        relation !== "researched" &&
        relation !== "continues"
      ) {
        return null;
      }
      return {
        fromFactId,
        toFactId,
        relation,
        label: typeof row.label === "string" ? row.label.trim().slice(0, 120) : "",
        strength:
          typeof row.strength === "number"
            ? Math.max(0, Math.min(1, row.strength))
            : 0.7,
      };
    })
    .filter((item): item is ProactiveTopicLink => item !== null);
  return links.length ? links.slice(0, 3) : undefined;
}

function parseInitiativeMove(value: unknown): ProactiveInitiativeMove | undefined {
  const moves: ProactiveInitiativeMove[] = [
    "clipboard_probe",
    "ide_invite",
    "context_fact",
    "followup_probe",
    "task_bridge",
    "concrete_step",
  ];
  return moves.find((move) => move === value);
}

function parseTone(value: unknown, fallback: ProactiveReplyTone): ProactiveReplyTone {
  const parsed =
    value === "advice" || value === "smalltalk" ? value : fallback;
  if (fallback === "smalltalk" && parsed === "advice") {
    return "smalltalk";
  }
  return parsed;
}

function parseBundleResponse(
  response: BundleResponse,
  input: ProactiveLlmInput,
  facts: ProactiveSignalFact[],
  primaryChain?: ProactiveTopicChain,
): ProactiveLlmBundle | null {
  const linkedThemes = Array.isArray(response.linkedThemes)
    ? response.linkedThemes
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const mergedAnchor =
    typeof response.mergedAnchor === "string" ? response.mergedAnchor.trim() : "";
  const narrativeBrief =
    typeof response.narrativeBrief === "string"
      ? response.narrativeBrief.trim()
      : "";
  const practicalHook =
    typeof response.practicalHook === "string" && response.practicalHook.trim()
      ? response.practicalHook.trim().slice(0, 320)
      : undefined;
  const adviceSteps = Array.isArray(response.adviceSteps)
    ? response.adviceSteps
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 4)
    : undefined;
  const usefulnessScore =
    typeof response.usefulnessScore === "number"
      ? Math.max(0, Math.min(1, response.usefulnessScore))
      : 0.5;
  const overlapsBanned = response.overlapsBanned === true;
  const tone = parseTone(response.tone, input.tone);
  let shouldSend = response.shouldSend !== false;
  const rejectReason =
    typeof response.rejectReason === "string"
      ? response.rejectReason.trim()
      : undefined;
  const topicLinks = parseTopicLinks(response.topicLinks, facts);
  const primaryChainSummary =
    typeof response.primaryChainSummary === "string"
      ? response.primaryChainSummary.trim()
      : undefined;
  const initiativeMove = parseInitiativeMove(response.initiativeMove);
  const groundFactIds = Array.isArray(response.groundFactIds)
    ? response.groundFactIds.filter((item): item is string => typeof item === "string")
    : undefined;
  const linkConfidence =
    typeof response.linkConfidence === "number"
      ? Math.max(0, Math.min(1, response.linkConfidence))
      : undefined;

  if (!linkedThemes.length || !mergedAnchor || !narrativeBrief) {
    return null;
  }
  if (overlapsBanned) {
    shouldSend = false;
  }
  if (usefulnessScore < USEFULNESS_MIN && tone === "advice") {
    shouldSend = false;
  }
  if (
    input.requirePracticalHook &&
    tone === "advice" &&
    !practicalHook &&
    !(adviceSteps && adviceSteps.length)
  ) {
    return null;
  }

  const graph = input.topicLinks ?? buildFactLinkGraph(facts, input.bundle);
  const resolvedTopicLinks =
    topicLinks?.length ? topicLinks : graph.length >= 1 ? graph.slice(0, 2) : undefined;
  let resolvedLinkConfidence = linkConfidence;

  if (
    tone === "advice" &&
    groundFactIds?.length &&
    practicalHook &&
    !hookGroundedInFacts(practicalHook, groundFactIds, facts)
  ) {
    resolvedLinkConfidence = Math.min(resolvedLinkConfidence ?? 0.5, 0.35);
  }

  if (
    primaryChain?.links.length &&
    !narrativeGroundedInChain(narrativeBrief, primaryChain, facts)
  ) {
    if (
      primaryChainSummary &&
      narrativeGroundedInChain(primaryChainSummary, primaryChain, facts)
    ) {
      // keep LLM narrative; chain summary validates separately
    } else {
      resolvedLinkConfidence = Math.min(resolvedLinkConfidence ?? 0.5, 0.4);
    }
  }

  return {
    tone,
    linkedThemes,
    mergedAnchor: mergedAnchor.slice(0, 180),
    narrativeBrief: narrativeBrief.slice(0, 700),
    practicalHook: tone === "advice" ? practicalHook : undefined,
    adviceSteps: tone === "advice" ? adviceSteps : undefined,
    usefulnessScore,
    shouldSend,
    rejectReason:
      rejectReason ||
      (overlapsBanned
        ? "пересечение с запрещёнными темами"
        : usefulnessScore < USEFULNESS_MIN && tone === "advice"
          ? "низкая полезность"
          : undefined),
    overlapsBanned,
    source: "llm",
    initiativeMove,
    groundFactIds,
    topicLinks: resolvedTopicLinks,
    primaryChainSummary:
      primaryChainSummary ?? primaryChain?.summarySeed ?? narrativeBrief.slice(0, 200),
    linkConfidence: resolvedLinkConfidence,
    selectedAdviceCandidate: input.adviceCandidate ?? undefined,
  };
}

function formatGroupedContextForPrompt(
  facts: ProactiveSignalFact[],
  bundle: InitiativeSignalBundle,
): string {
  const formatGroup = (items: ProactiveSignalFact[]) =>
    items
      .map((fact) => `- [${fact.kind}] ${fact.label}: ${fact.detail}`)
      .join("\n");

  const goalFacts = facts.filter((fact) =>
    ["goal", "task"].includes(fact.kind),
  );
  const situationFacts = facts.filter((fact) =>
    ["file", "screen", "session", "wm", "chat", "query", "hypothesis"].includes(
      fact.kind,
    ),
  );
  const constraintFacts = facts.filter((fact) =>
    ["urgency", "reference"].includes(fact.kind),
  );
  const blockerLines = bundle.focusBlockers
    .slice(0, 2)
    .map((blocker) => `- [blocker] Блокер: ${blocker.slice(0, 120)}`);

  return [
    goalFacts.length ? `Цель:\n${formatGroup(goalFacts)}` : "",
    situationFacts.length ? `Текущая ситуация:\n${formatGroup(situationFacts)}` : "",
    constraintFacts.length || blockerLines.length
      ? `Ограничения:\n${[...formatGroup(constraintFacts), ...blockerLines].filter(Boolean).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const GROUNDING_FACT_KINDS = new Set<ProactiveSignalFactKind>([
  "file",
  "clipboard",
  "task",
  "query",
  "screen",
  "wm",
  "urgency",
  "goal",
  "hypothesis",
  "reference",
]);

const GENERIC_ADVICE_PATTERNS = [
  /сделай один следующий шаг/i,
  /загляни(?: ещё раз)?/i,
  /посмотри(?: ещё раз)?/i,
  /посмотри[^.?!]{0,80}(комментари|comments?|примечан|заметк)/i,
  /взглян[иу][^.?!]{0,80}(комментари|comments?|примечан|заметк)/i,
  /нет ли[^.?!]{0,80}(комментари|comments?|примечан|заметк)/i,
  /обзор[^.?!]{0,80}(файл|раздел|секци)/i,
  /пройдись[^.?!]{0,80}(по файлу|по раздел)/i,
  /выдели главные моменты/i,
  /сверь текущий экран/i,
  /проверь самый свежий/i,
  /провер(?:им|ь).*ещё раз/i,
  /мало ли что/i,
  /вдруг там.*ошибк/i,
  /загляни.*\bв\b/i,
  /давай проверим/i,
];

const STRONG_GROUNDING_FACT_KINDS = new Set<ProactiveSignalFactKind>([
  "clipboard",
  "urgency",
  "query",
  "task",
  "reference",
  "hypothesis",
]);

export function hasStrongAdviceContext(facts: ProactiveSignalFact[]): boolean {
  return facts.some((fact) => STRONG_GROUNDING_FACT_KINDS.has(fact.kind));
}

export function isThinAdviceContext(facts: ProactiveSignalFact[]): boolean {
  const groundingFacts = facts.filter((fact) =>
    GROUNDING_FACT_KINDS.has(fact.kind),
  );
  return groundingFacts.length > 0 && !hasStrongAdviceContext(facts);
}

export function isGenericAdviceText(text: string): boolean {
  return GENERIC_ADVICE_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildFileClarifyingQuestion(fileDetail: string): string {
  const file = fileDetail.replace(/\s+/g, " ").trim().slice(0, 80);
  const templates = [
    `Сейчас фокус на ${file} — дописываешь запись к релизу или правишь уже существующий блок?`,
    `Вижу ${file} — что именно хочешь сдвинуть: формат, содержание или проверку перед коммитом?`,
    `По ${file}: это черновик для следующей версии или финальная правка? Скажи — подскажу, что не забыть проверить.`,
    `Ты в ${file} — какой результат нужен сейчас: один конкретный пункт, секция или полный проход по файлу?`,
  ];
  return templates[hashStringDjb2(file) % templates.length];
}

function countFactsReferencedInText(
  text: string,
  facts: ProactiveSignalFact[],
): number {
  return facts.filter((fact) => textMentionsFact(text, fact)).length;
}

function bundleReferencesSingleFactor(
  bundle: ProactiveLlmBundle,
  facts: ProactiveSignalFact[],
): boolean {
  const groundingFacts = facts.filter((fact) =>
    GROUNDING_FACT_KINDS.has(fact.kind),
  );
  if (groundingFacts.length < 2) {
    return false;
  }
  const text = [
    bundle.primaryChainSummary,
    bundle.narrativeBrief,
    bundle.practicalHook,
    ...(bundle.adviceSteps ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return countFactsReferencedInText(text, groundingFacts) <= 1;
}

export function isSingleFactorGenericAdvice(
  reply: string,
  facts: ProactiveSignalFact[],
  bundle: ProactiveLlmBundle,
): boolean {
  const groundingFacts = facts.filter((fact) =>
    GROUNDING_FACT_KINDS.has(fact.kind),
  );
  if (groundingFacts.length < 2) {
    return false;
  }
  const isGenericTemplate = isGenericAdviceText(reply);
  const isFallbackGeneric = Boolean(
    bundle.rejectReason?.includes("fallback after") &&
      bundle.initiativeMove === "concrete_step",
  );
  const refCount = countFactsReferencedInText(reply, groundingFacts);
  return (isGenericTemplate || isFallbackGeneric) && refCount < 2;
}

export function isThinContextGenericAdvice(
  reply: string,
  facts: ProactiveSignalFact[],
  bundle: ProactiveLlmBundle,
): boolean {
  if (bundle.tone !== "advice" || !isThinAdviceContext(facts)) {
    return false;
  }
  if (isGenericAdviceText(reply)) {
    return true;
  }
  return Boolean(
    bundle.rejectReason?.includes("fallback after") &&
      ["ide_invite", "concrete_step"].includes(bundle.initiativeMove ?? ""),
  );
}

export function replyMissesClipboardGrounding(
  reply: string,
  facts: ProactiveSignalFact[],
): boolean {
  const clipFacts = facts.filter((fact) => fact.kind === "clipboard");
  if (!clipFacts.length) {
    return false;
  }
  return !clipFacts.some((fact) => textMentionsFact(reply, fact));
}

function replyMissesClipboardSemanticAnchor(
  reply: string,
  facts: ProactiveSignalFact[],
): boolean {
  const richClipFacts = facts.filter(
    (fact) =>
      fact.kind === "clipboard" && isClipboardSemanticallyRich(fact.detail),
  );
  if (!richClipFacts.length) {
    return false;
  }
  const lower = reply.toLowerCase();
  return !richClipFacts.some((fact) =>
    clipboardPrimaryAnchors(fact.detail).some((anchor) =>
      lower.includes(anchor.toLowerCase()),
    ),
  );
}

function formatFactsForPrompt(facts: ProactiveSignalFact[]): string {
  return facts
    .map((fact) => `- [${fact.kind}] ${fact.label}: ${fact.detail}`)
    .join("\n");
}

function formatTopicChainsForPrompt(chains: ProactiveTopicChain[]): string {
  return chains
    .map(
      (chain, index) =>
        `Цепочка ${index + 1}: ${chain.summarySeed}\n` +
        chain.links
          .map((link) => `  - ${link.fromFactId} → ${link.toFactId} (${link.relation}): ${link.label}`)
          .join("\n"),
    )
    .join("\n\n");
}

function formatMoveHintsForPrompt(hints: ProactiveMoveHint[]): string {
  return hints
    .map(
      (hint) =>
        `- ${hint.move} [${hint.groundFactIds.join(", ")}]: ${hint.hookSeed}` +
        (hint.observationSeed ? ` | наблюдение: ${hint.observationSeed}` : "") +
        (hint.questionSeed ? ` | вопрос: ${hint.questionSeed}` : ""),
    )
    .join("\n");
}

function formatClipboardFactsForPrompt(facts: ProactiveSignalFact[]): string {
  const clips = facts.filter((fact) => fact.kind === "clipboard");
  if (!clips.length) {
    return "";
  }
  return clips
    .map((fact) => {
      const semantics = describeClipboardSemantics(fact.detail);
      return [
        `- [${fact.id}] ${fact.detail}`,
        semantics ? `  anchors: ${semantics}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function bundleSynthesisRegenIssues(
  bundle: ProactiveLlmBundle,
  facts: ProactiveSignalFact[],
): string[] {
  if (bundle.tone !== "advice") {
    return [];
  }
  const issues: string[] = [];
  const text = [
    bundle.practicalHook,
    bundle.narrativeBrief,
    ...(bundle.adviceSteps ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  for (const novelty of evaluateAdviceNovelty({
    text,
    candidateKind: bundle.selectedAdviceCandidate?.kind,
  })) {
    issues.push(novelty.reason);
  }
  const clipFacts = facts.filter((fact) => fact.kind === "clipboard");
  if (
    clipFacts.length &&
    bundle.practicalHook &&
    !clipFacts.some((fact) =>
      hookGroundedInFacts(bundle.practicalHook!, [fact.id], facts),
    )
  ) {
    issues.push("нет цитаты буфера в practicalHook");
  }
  if (bundleReferencesSingleFactor(bundle, facts)) {
    issues.push("single-factor");
  }
  if (
    bundle.practicalHook &&
    replyMissesClipboardSemanticAnchor(bundle.practicalHook, facts)
  ) {
    issues.push("нет конкретных элементов из буфера в practicalHook");
  }
  return issues;
}

function bundleSystemPrompt(isAdvice: boolean, requireHook: boolean): string {
  return [
    PROACTIVE_CHARACTER_RULE,
    VN_CHARACTER_RULE,
    "Свяжи сигналы пользователя в одну причинно-следственную нить для проактивной реплики Ari.",
    isAdvice
      ? "Режим: advice. Свяжи минимум два фактора (цель + ситуация + ограничение) в одну рекомендацию: «сделай X, потому что в твоей ситуации это решает Y и Z». narrativeBrief — одно предложение в этой форме. primaryChainSummary — назови минимум два фактора и как они вместе определяют совет. practicalHook — конкретный заход-утверждение с цитатой из факта (не вопрос), кроме initiativeMove clarifying_probe/ask_clarifying. adviceSteps — 2–4 проверяемых шага; не numbered list. Запрещён одиночный совет «сделай шаг от файла X»."
      : "Режим: smalltalk. Одна живая нить без советов и next step. Можно выбрать контекстное наблюдение или боковую тему: музыка, игры, еда, настроение, странная бытовая мысль, культурный/новостной повод. Не утверждай конкретную свежую новость без live-проверки. Предпочитай утверждение/наблюдение; не заканчивай вопросом.",
    isAdvice
      ? "Если есть факт clipboard — это главный ориентир: процитируй фрагмент из буфера и построй совет вокруг того, что пользователь только что копировал или отлаживал."
      : "",
    isAdvice
      ? "Если в clipboard есть anchors/идентификаторы/узлы/связи вроде Gates{...} или Input -> Cmd, practicalHook обязан назвать 1–3 этих элемента и объяснить, какую связь или gate проверить. Запрещены советы уровня «посмотри файл», «скопируй сюда», «сделай перерыв» без разбора элементов буфера."
      : "",
    isAdvice
      ? "Если есть RAG/reference/web facts, извлеки из них вероятное решение проблемы. Не ограничивайся «поищи/проверь»: дай гипотезу, конкретный fix/команду/настройку и короткую проверку исхода."
      : "",
    isAdvice
      ? "Если передан фрагмент реального кода (из project binder), анализируй именно код: назови конкретные функции/символы/условия, вероятную проблему и один безопасный следующий шаг. Запрещено обсуждать «комментарии к файлу» или ограничиваться именем файла."
      : "",
    isAdvice
      ? "Если есть факт «Паттерн застревания» или input friction, действуй как ранний советчик: назови вероятное узкое место, один проверяемый шаг и критерий результата. Не задавай уточняющий вопрос, если можно дать безопасную проверку."
      : "",
    isAdvice
      ? "Если единственный конкретный факт — имя файла или окно IDE, не выдумывай обзор комментариев/разделов/заметок. Верни shouldSend=false или один короткий уточняющий вопрос о месте застревания."
      : "",
    requireHook
      ? "Обязательно practicalHook с цитатой из fact + initiativeMove + groundFactIds + topicLinks."
      : "Верни initiativeMove, groundFactIds, topicLinks если есть граф связей.",
    "linkedThemes — max 2 коротких ярлыка, не дубли raw facts. Запрещены generic hooks без цитаты.",
    isAdvice
      ? "practicalHook по умолчанию — утверждение или проверяемый шаг; знак вопроса только при initiativeMove clarifying_probe или ask_clarifying."
      : "",
    "Не выдумывай факты. overlapsBanned=true если якорь повторяет запрещённые темы.",
    "usefulnessScore 0–1: насколько реплика даст конкретную пользу сейчас.",
    'JSON: {"tone":"advice|smalltalk","linkedThemes":[],"mergedAnchor":"","narrativeBrief":"","primaryChainSummary":"","topicLinks":[{"fromFactId":"","toFactId":"","relation":"same_file","label":"","strength":0.8}],"initiativeMove":"clipboard_probe","groundFactIds":[],"practicalHook":null,"adviceSteps":[],"usefulnessScore":0.8,"linkConfidence":0.8,"shouldSend":true,"rejectReason":null,"overlapsBanned":false}.',
  ]
    .filter(Boolean)
    .join("\n");
}

async function callSynthesisLlm(
  settings: AppSettings,
  input: ProactiveLlmInput,
  facts: ProactiveSignalFact[],
  requireHook: boolean,
  primaryChain?: ProactiveTopicChain,
  correction?: string,
): Promise<ProactiveLlmBundle | null> {
  const banned = input.bannedTopics ?? [];
  const isAdvice = input.tone === "advice";
  const clipBlock = formatClipboardFactsForPrompt(facts);
  const groupedContext = formatGroupedContextForPrompt(facts, input.bundle);
  const response = await completeLlmJson<BundleResponse>(
    [
      {
        role: "system",
        content: bundleSystemPrompt(isAdvice, requireHook),
      },
      {
        role: "user",
        content: [
          `Запрошенный tone: ${input.tone}`,
          groupedContext
            ? `Сгруппированный контекст (свяжи факторы вместе, не по одному):\n${groupedContext}`
            : "",
          `Факты:\n${formatFactsForPrompt(facts) || "нет"}`,
          clipBlock
            ? `Буфер (приоритет — practicalHook должен цитировать фрагмент):\n${clipBlock}`
            : "",
          input.topicChains?.length
            ? `Граф связей (объясни причинность, не списком):\n${formatTopicChainsForPrompt(input.topicChains)}`
            : "",
          input.moveHints?.length
            ? `Рекомендуемые ходы ассистента (выбери один):\n${formatMoveHintsForPrompt(input.moveHints)}`
            : "",
          input.adviceCandidate
            ? `Выбранный planner-ход совета (следуй ему, не заменяй generic check-in):\n${formatAdviceCandidateForPrompt(input.adviceCandidate)}`
            : "",
          input.adviceMoveGuidance
            ? `Advice move policy:\n${input.adviceMoveGuidance}`
            : "",
          input.ragSnippets?.length
            ? `Фрагменты RAG/reference для решения проблемы:\n${input.ragSnippets.map((snippet) => `- ${snippet.slice(0, 360)}`).join("\n")}`
            : "",
          input.codeExcerpts?.length
            ? `Реальный код из файла ${input.codeExcerpts[0]!.file} (проанализируй сам код, не имя файла):\n\`\`\`\n${redactAndTruncate(input.codeExcerpts[0]!.text, 2000)}\n\`\`\``
            : "",
          input.candidateTopics?.length
            ? `Кандидаты (ярлыки, не копируй дословно):\n${input.candidateTopics.join("\n")}`
            : "",
          banned.length ? `Запрещённые темы:\n${banned.slice(0, 8).join("\n")}` : "",
          correction
            ? `Предыдущий ответ отклонён. Исправь: ${correction}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    settings,
    420,
    "initiativeSynthesis",
  );
  return parseBundleResponse(response, input, facts, primaryChain);
}

function enrichProactiveLlmInput(
  input: ProactiveLlmInput,
  facts: ProactiveSignalFact[],
): ProactiveLlmInput {
  const graph = buildFactLinkGraph(facts, input.bundle);
  const topicChains = input.topicChains ?? inferTopicChains(graph, facts, 2);
  const moveHints =
    input.moveHints ??
    inferInitiativeMoves(input.bundle, facts, input.ragSnippets ?? []);
  return {
    ...input,
    topicChains,
    topicLinks: input.topicLinks ?? graph,
    moveHints,
  };
}

export async function synthesizeProactiveBundle(
  settings: AppSettings,
  input: ProactiveLlmInput,
): Promise<ProactiveLlmBundle> {
  const facts = collectProactiveSignalFacts(input);
  const enriched = enrichProactiveLlmInput(input, facts);
  const primaryChain = enriched.topicChains?.[0];
  const banned = enriched.bannedTopics ?? [];
  const llmOnline = enriched.llmOnline !== false;

  if (!llmOnline) {
    return rememberProactiveLlmBundle(
      createRejectedProactiveLlmBundle(enriched.tone, "llm offline"),
      facts,
    );
  }

  const fingerprint = factFingerprint(
    facts,
    enriched.tone,
    banned,
    enriched.adviceCandidate,
  );
  const cached = bundleCache.get(fingerprint);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return rememberProactiveLlmBundle(cached.value, facts);
  }

  try {
    const isGigaChatAdvice =
      settings.llmProvider === "gigachat" && enriched.tone === "advice";
    let parsed = await callSynthesisLlm(
      settings,
      enriched,
      facts,
      false,
      primaryChain,
    );
    if (!isGigaChatAdvice) {
      if (!parsed && isLiteLlmModel(settings)) {
        parsed = await callSynthesisLlm(
          settings,
          enriched,
          facts,
          true,
          primaryChain,
        );
      }
      if (
        !parsed &&
        enriched.tone === "advice" &&
        facts.some((fact) =>
          ["clipboard", "file", "urgency"].includes(fact.kind),
        )
      ) {
        parsed = await callSynthesisLlm(
          settings,
          enriched,
          facts,
          true,
          primaryChain,
        );
      }
      if (parsed && enriched.tone === "advice") {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const regenIssues = bundleSynthesisRegenIssues(parsed, facts);
          if (!regenIssues.length) {
            break;
          }
          const retry = await callSynthesisLlm(
            settings,
            enriched,
            facts,
            true,
            primaryChain,
            regenIssues.join("; "),
          );
          if (!retry) {
            break;
          }
          parsed = retry;
        }
      }
    }
    if (parsed) {
      const adviceNeedsFallback =
        enriched.tone === "advice" &&
        (!parsed.shouldSend ||
          parsed.overlapsBanned ||
          parsed.usefulnessScore < USEFULNESS_MIN);
      if (adviceNeedsFallback) {
        const rejectLabel = parsed.overlapsBanned
          ? "llm synthesis overlaps banned"
          : parsed.usefulnessScore < USEFULNESS_MIN
            ? "llm synthesis low usefulness"
            : "llm synthesis rejected";
        const fallback = tryAdviceFallbackChain(enriched, facts, rejectLabel);
        if (fallback) {
          bundleCache.set(fingerprint, { at: Date.now(), value: fallback });
          return rememberProactiveLlmBundle(fallback, facts);
        }
        if (enriched.tone === "advice") {
          const clarifying = buildClarifyingProbeBundle(
            enriched,
            facts,
            rejectLabel,
          );
          if (clarifying) {
            bundleCache.set(fingerprint, { at: Date.now(), value: clarifying });
            return rememberProactiveLlmBundle(clarifying, facts);
          }
          return rememberProactiveLlmBundle(
            createRejectedProactiveLlmBundle(enriched.tone, rejectLabel),
            facts,
          );
        }
      }
      bundleCache.set(fingerprint, { at: Date.now(), value: parsed });
      return rememberProactiveLlmBundle(parsed, facts);
    }
  } catch {
    const fallback = tryAdviceFallbackChain(
      enriched,
      facts,
      "llm synthesis failed",
    );
    if (fallback) {
      bundleCache.set(fingerprint, { at: Date.now(), value: fallback });
      return rememberProactiveLlmBundle(fallback, facts);
    }
    return rememberProactiveLlmBundle(
      createRejectedProactiveLlmBundle(enriched.tone, "llm synthesis failed"),
      facts,
    );
  }

  const fallback = tryAdviceFallbackChain(
    enriched,
    facts,
    "llm synthesis rejected",
  );
  if (fallback) {
    bundleCache.set(fingerprint, { at: Date.now(), value: fallback });
    return rememberProactiveLlmBundle(fallback, facts);
  }

  return rememberProactiveLlmBundle(
    createRejectedProactiveLlmBundle(enriched.tone, "llm synthesis rejected"),
    facts,
  );
}

export function buildGateContextFromBundle(bundle: ProactiveLlmBundle): string {
  return [
    bundle.primaryChainSummary
      ? `Смысловая цепочка: ${bundle.primaryChainSummary}`
      : `Смысл момента: ${bundle.narrativeBrief}`,
    bundle.topicLinks?.length
      ? `Связи: ${bundle.topicLinks.map((link) => link.label).join(" → ")}`
      : bundle.linkedThemes.length
        ? `Связанные нити: ${bundle.linkedThemes.join(" | ")}`
        : "",
    `Якорь: ${bundle.mergedAnchor}`,
    bundle.initiativeMove ? `Ход: ${bundle.initiativeMove}` : "",
    bundle.selectedAdviceCandidate
      ? `Planner: ${bundle.selectedAdviceCandidate.kind} — ${bundle.selectedAdviceCandidate.actionText}`
      : "",
    bundle.adviceSteps?.length
      ? `Шаги: ${bundle.adviceSteps.join(" | ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildProactiveSummaryFromBundle(
  bundle: ProactiveLlmBundle,
): string {
  const parts = [bundle.primaryChainSummary ?? bundle.narrativeBrief];
  if (bundle.tone === "advice" && bundle.practicalHook) {
    parts.push(`Заход: ${bundle.practicalHook}`);
  }
  if (bundle.initiativeMove) {
    parts.push(`Ход: ${bundle.initiativeMove}`);
  }
  if (bundle.selectedAdviceCandidate) {
    parts.push(
      `План: ${bundle.selectedAdviceCandidate.kind} — ${bundle.selectedAdviceCandidate.actionText}`,
    );
  }
  if (bundle.adviceSteps?.length) {
    parts.push(`Шаги: ${bundle.adviceSteps.join("; ")}`);
  }
  return parts.join(" · ");
}

export function localReplyQualityCheck(
  bundle: ProactiveLlmBundle,
  reply: string,
  facts: ProactiveSignalFact[],
): ProactiveReplyQualityResult | null {
  const issues: string[] = [];
  const trimmed = reply.trim();
  if (!trimmed) {
    return { acceptable: false, reason: "пустая реплика", issues: ["empty"] };
  }
  const noveltyIssues = evaluateAdviceNovelty({ text: trimmed });
  if (noveltyIssues.some((issue) => issue.kind === "fallback_meta")) {
    issues.push("proactive meta commentary");
  }

  const isFallbackBundle = bundle.rejectReason?.includes("fallback");
  const isClarifyingBundle = bundle.rejectReason?.includes("clarifying probe");

  if (
    !isFallbackBundle &&
    bundle.groundFactIds?.length &&
    bundle.initiativeMove &&
    ["clipboard_probe", "ide_invite", "followup_probe", "context_fact"].includes(
      bundle.initiativeMove,
    ) &&
    !hookGroundedInFacts(trimmed, bundle.groundFactIds, facts)
  ) {
    issues.push("missing fact quote");
  }

  if (
    !isFallbackBundle &&
    bundle.primaryChainSummary &&
    bundle.topicLinks?.length &&
    bundle.initiativeMove &&
    ["clipboard_probe", "ide_invite"].includes(bundle.initiativeMove) &&
    !bundle.primaryChainSummary
      .split(/\W+/)
      .filter((word) => word.length > 4)
      .some((word) => trimmed.toLowerCase().includes(word.toLowerCase()))
  ) {
    issues.push("weak chain narrative");
  }

  const probeCandidate =
    bundle.selectedAdviceCandidate?.kind === "clarifying_probe" ||
    bundle.selectedAdviceCandidate?.kind === "uncertainty_probe";
  const clarifyingMove =
    isClarifyingBundle ||
    probeCandidate ||
    bundle.initiativeMove === "clipboard_probe" ||
    bundle.initiativeMove === "ide_invite" ||
    bundle.initiativeMove === "followup_probe";
  if (
    bundle.tone === "advice" &&
    !clarifyingMove &&
    /[?？]\s*$/u.test(trimmed)
  ) {
    issues.push("trailing question");
  }
  if (
    !clarifyingMove &&
    (bundle.tone === "advice" || bundle.tone === "smalltalk") &&
    isSolicitationSentence(getLastSentence(trimmed))
  ) {
    issues.push("implicit solicitation");
  }
  if (
    bundle.tone === "advice" &&
    (isClarifyingBundle ||
      (probeCandidate &&
        (bundle.initiativeMove === "clipboard_probe" ||
          bundle.initiativeMove === "ide_invite" ||
          bundle.initiativeMove === "context_fact")))
  ) {
    if (
      !/[?？]/.test(trimmed) &&
      !/(?:расскаж|опиш|что именно|где именно|уточни)/i.test(trimmed)
    ) {
      issues.push("missing question");
    }
  }

  if (
    bundle.tone === "advice" &&
    !isClarifyingBundle &&
    isSingleFactorGenericAdvice(trimmed, facts, bundle)
  ) {
    issues.push("single-factor generic");
  }

  if (
    bundle.tone === "advice" &&
    !isClarifyingBundle &&
    isThinContextGenericAdvice(trimmed, facts, bundle)
  ) {
    issues.push("thin-context generic");
  }

  if (
    bundle.tone === "advice" &&
    !isClarifyingBundle &&
    replyMissesClipboardGrounding(trimmed, facts)
  ) {
    issues.push("missing clipboard quote");
  }
  if (
    bundle.tone === "advice" &&
    !isClarifyingBundle &&
    replyMissesClipboardSemanticAnchor(trimmed, facts)
  ) {
    issues.push("missing clipboard semantic anchor");
  }

  if (issues.length) {
    return { acceptable: false, reason: issues.join(", "), issues };
  }
  return null;
}

export type ProactiveReplyQualityResult = {
  acceptable: boolean;
  reason: string;
  issues: string[];
};

export async function validateProactiveReplyLlm(
  settings: AppSettings,
  bundle: ProactiveLlmBundle,
  reply: string,
  facts: ProactiveSignalFact[] = [],
): Promise<ProactiveReplyQualityResult> {
  const local = localReplyQualityCheck(bundle, reply, facts);
  if (local && !local.acceptable) {
    return local;
  }

  if (isLiteLlmModel(settings)) {
    return {
      acceptable: true,
      reason: "lite model — только локальная проверка",
      issues: [],
    };
  }

  try {
    const response = await completeLlmJson<QualityResponse>(
      [
        {
          role: "system",
          content: [
            "Оцени проактивную реплику Ari.",
            "acceptable=false если: мета про «сюжет/процесс/результат», нет конкретики из bundle, игнор practicalHook/adviceSteps/primaryChainSummary, generic hook без цитаты факта, пустая вода, тон безличного ассистента/канцелярита вместо Ari, или финальный вопрос-хвост в advice без clarifying move.",
            'JSON: {"acceptable":true|false,"reason":"кратко","issues":["..."]}.',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Tone: ${bundle.tone}`,
            bundle.primaryChainSummary
              ? `Chain: ${bundle.primaryChainSummary}`
              : `Narrative: ${bundle.narrativeBrief}`,
            bundle.initiativeMove ? `Move: ${bundle.initiativeMove}` : "",
            bundle.practicalHook ? `Hook: ${bundle.practicalHook}` : "",
            bundle.adviceSteps?.length
              ? `Steps: ${bundle.adviceSteps.join(" | ")}`
              : "",
            `Reply:\n${reply.slice(0, 800)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      settings,
      180,
      "initiativeSynthesis",
    );
    const issues = Array.isArray(response.issues)
      ? response.issues.filter((item): item is string => typeof item === "string")
      : [];
    const acceptable = response.acceptable === true;
    return {
      acceptable,
      reason:
        typeof response.reason === "string"
          ? response.reason.trim()
          : acceptable
            ? "ok"
            : "не прошла проверку",
      issues,
    };
  } catch {
    return { acceptable: true, reason: "validator offline", issues: [] };
  }
}
