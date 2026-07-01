import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import { isLiteLlmModel } from "../llm/modelRouter";
import { redactSecrets } from "../platform/secretRedaction";
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
import { deriveScreenState, describeScreenState } from "./screenState";

export type { ProactiveInitiativeMove, ProactiveMoveHint, ProactiveTopicLink, ProactiveTopicChain };

export type ProactiveSignalFactKind =
  | "file"
  | "clipboard"
  | "chat"
  | "task"
  | "query"
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
  source: "llm";
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
  | "llm synthesis rejected";

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
  topicChains?: ProactiveTopicChain[];
  topicLinks?: ProactiveTopicLink[];
  adviceCandidate?: AdviceCandidate | null;
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
let lastFactsSnapshot: ProactiveSignalFact[] = [];

export function getLastProactiveSignalFacts(): ProactiveSignalFact[] {
  return lastFactsSnapshot;
}

function stripEmotionTags(text: string): string {
  return text.replace(/<emotion>[^<]+<\/emotion>/gi, "").trim();
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
  lastFactsSnapshot = [];
}

export function getLastProactiveLlmBundle(): ProactiveLlmBundle | null {
  return lastBundleSnapshot;
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
    source: "llm",
  };
}

function createAdviceFallbackBundle(
  input: ProactiveLlmInput,
  facts: ProactiveSignalFact[],
  reason: ProactiveLlmSystemRejectReason,
): ProactiveLlmBundle | null {
  if (input.tone !== "advice") {
    return null;
  }
  const candidate = input.adviceCandidate ?? null;
  const groundingFacts = facts.filter((fact) =>
    ["file", "clipboard", "task", "query", "urgency", "screen", "hypothesis"].includes(
      fact.kind,
    ),
  );
  if (!candidate && groundingFacts.length === 0) {
    return null;
  }

  const primaryFact = groundingFacts[0];
  const evidenceIds = candidate?.evidenceIds.length
    ? candidate.evidenceIds
    : groundingFacts.slice(0, 3).map((fact) => fact.id);
  const actionText =
    candidate?.actionText ??
    (primaryFact
      ? `Сделай один следующий шаг от факта: ${primaryFact.detail}`
      : "Сделай один следующий шаг по текущему рабочему контексту.");
  const anchor =
    input.candidateTopics?.[0] ??
    candidate?.kind ??
    primaryFact?.detail.slice(0, 80) ??
    "текущий рабочий контекст";
  const linkedThemes = [
    candidate?.kind,
    ...groundingFacts.map((fact) => fact.detail.slice(0, 60)),
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .slice(0, 2);

  return {
    tone: "advice",
    linkedThemes,
    mergedAnchor: anchor.slice(0, 180),
    narrativeBrief: candidate
      ? `Planner выбрал ${candidate.kind}: ${candidate.reason}`
      : `Совет опирается на текущие факты: ${groundingFacts
          .slice(0, 2)
          .map((fact) => fact.label)
          .join(", ")}`,
    practicalHook: actionText.slice(0, 220),
    adviceSteps: [actionText.slice(0, 180)],
    usefulnessScore: Math.max(0.62, candidate?.expectedUtility ?? 0.62),
    shouldSend: true,
    rejectReason: `fallback after ${reason}`,
    overlapsBanned: false,
    source: "llm",
    initiativeMove: "concrete_step",
    groundFactIds: evidenceIds,
    primaryChainSummary: candidate
      ? `${candidate.reason}: ${actionText.slice(0, 160)}`
      : actionText.slice(0, 200),
    linkConfidence: candidate?.confidence ?? 0.58,
    selectedAdviceCandidate: candidate ?? undefined,
  };
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
    facts.push({ id, kind, label, detail: trimmed.slice(0, 200) });
  };

  if (bundle.editorFile) {
    push("file", `file:${bundle.editorFile}`, "Файл в IDE", bundle.editorFile);
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
      redactSecrets(clip.text).slice(0, 200),
    );
  }

  const recentUser =
    input.recentUserMessage?.trim() ||
    [...(input.recentChatTurns ?? [])]
      .reverse()
      .find((turn) => turn.role === "user")
      ?.content;
  if (recentUser) {
    push(
      "chat",
      "chat:last-user",
      "Последний вопрос",
      stripEmotionTags(recentUser).slice(0, 120),
    );
  }

  if (bundle.nextTaskTitle) {
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
    push("query", `query:${theme}`, "Тема поиска", theme);
  }
  for (const entry of bundle.advisor.activitySummary.recentSignals
    .filter((signal) => signal.kind === "query_topic")
    .slice(-2)) {
    push(
      "query",
      `query:${entry.topic}`,
      `Запрос (${entry.source ?? "app"})`,
      entry.topic,
    );
  }

  for (const entry of pruneWorkingMemory(bundle.advisor.now).slice(-4)) {
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
      describeScreenState(screenState),
    );
  }

  const hypotheses = buildAdvisorHypotheses(bundle, facts);
  const hypothesisSummary = describeAdvisorHypotheses(hypotheses);
  if (hypothesisSummary) {
    push(
      "hypothesis",
      `hypothesis:${hypotheses[0]?.kind ?? "unknown"}`,
      "Вывод советчика",
      hypothesisSummary,
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
  if (goals) {
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
      ? response.practicalHook.trim().slice(0, 220)
      : undefined;
  const adviceSteps = Array.isArray(response.adviceSteps)
    ? response.adviceSteps
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3)
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
    narrativeBrief: narrativeBrief.slice(0, 600),
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
    .map((fact) => `- [${fact.id}] ${fact.detail}`)
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
  return issues;
}

function bundleSystemPrompt(isAdvice: boolean, requireHook: boolean): string {
  return [
    PROACTIVE_CHARACTER_RULE,
    VN_CHARACTER_RULE,
    "Свяжи сигналы пользователя в одну причинно-следственную нить для проактивной реплики Ari.",
    isAdvice
      ? "Режим: advice. narrativeBrief — одно предложение «X потому что Y, сейчас Z». practicalHook — заход Ari за плечом с цитатой из факта (буфер, файл, вопрос). adviceSteps — 1–3 проверяемых шага от первого лица, не numbered list."
      : "Режим: smalltalk. Одна живая нить без советов и next step. Можно выбрать контекстное наблюдение или боковую тему: музыка, игры, еда, настроение, странная бытовая мысль, культурный/новостной повод. Не утверждай конкретную свежую новость без live-проверки. Предпочитай утверждение/наблюдение; не заканчивай вопросом.",
    requireHook
      ? "Обязательно practicalHook с цитатой из fact + initiativeMove + groundFactIds + topicLinks."
      : "Верни initiativeMove, groundFactIds, topicLinks если есть граф связей.",
    "linkedThemes — max 2 коротких ярлыка, не дубли raw facts. Запрещены generic hooks без цитаты.",
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
          input.ragSnippets?.length
            ? `Фрагменты из документов:\n${input.ragSnippets.map((snippet) => `- ${snippet.slice(0, 160)}`).join("\n")}`
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
    let parsed = await callSynthesisLlm(settings, enriched, facts, false, primaryChain);
    if (!parsed && isLiteLlmModel(settings)) {
      parsed = await callSynthesisLlm(settings, enriched, facts, true, primaryChain);
    }
    if (
      !parsed &&
      enriched.tone === "advice" &&
      facts.some((fact) => ["clipboard", "file", "urgency"].includes(fact.kind))
    ) {
      parsed = await callSynthesisLlm(settings, enriched, facts, true, primaryChain);
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
    if (parsed) {
      if (!parsed.shouldSend && !parsed.overlapsBanned) {
        const fallback = createAdviceFallbackBundle(
          enriched,
          facts,
          "llm synthesis rejected",
        );
        if (fallback) {
          bundleCache.set(fingerprint, { at: Date.now(), value: fallback });
          return rememberProactiveLlmBundle(fallback, facts);
        }
      }
      bundleCache.set(fingerprint, { at: Date.now(), value: parsed });
      return rememberProactiveLlmBundle(parsed, facts);
    }
  } catch {
    const fallback = createAdviceFallbackBundle(
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

  const fallback = createAdviceFallbackBundle(
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

function localReplyQualityCheck(
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

  if (
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

  if (
    bundle.tone === "advice" &&
    (bundle.initiativeMove === "clipboard_probe" ||
      bundle.initiativeMove === "ide_invite")
  ) {
    if (!/[?？]/.test(trimmed) && !/(?:расскаж|опиш|что именно|где именно)/i.test(trimmed)) {
      issues.push("missing question");
    }
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
            "acceptable=false если: мета про «сюжет/процесс/результат», нет конкретики из bundle, игнор practicalHook/adviceSteps/primaryChainSummary, generic hook без цитаты факта, пустая вода, или тон безличного ассистента/канцелярита вместо Ari.",
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
