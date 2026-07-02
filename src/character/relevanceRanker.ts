import type { AdviceFeedback, AdviceLedgerEntry } from "./adviceLedger";
import type { AdviceCandidate, AdviceCandidateKind } from "./advicePlanner";
import type { AdviceUrgency } from "./adviceUrgency";
import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveToneSnapshot } from "../memory/memoryTelemetry";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";
import { isClipboardSemanticallyRich } from "../platform/clipboardSemantics";

export type RelevanceCandidateKind =
  | "try_advice"
  | "try_smalltalk"
  | "silent"
  | AdviceCandidateKind;

export type RelevanceFeatureKey =
  | "bias"
  | "toolIde"
  | "toolTerminal"
  | "toolBrowser"
  | "clipboard"
  | "clipboardRich"
  | "clipboardDiagnostic"
  | "terminalError"
  | "inputFriction"
  | "stuck"
  | "query"
  | "task"
  | "breakDue"
  | "adviceReady"
  | "smalltalkReady"
  | "recentAdviceStreak"
  | "adviceSkew"
  | "smalltalkSkew"
  | "llmOnline"
  | "busy"
  | "candidateAdvice"
  | "candidateSmalltalk"
  | "candidateSilent"
  | "candidateDebug"
  | "candidateClarify"
  | "candidateRest"
  | "candidateDocs"
  | "candidateTask"
  | "candidateRefocus"
  | "candidateClipboard";

export type RelevanceFeatureVector = Partial<Record<RelevanceFeatureKey, number>>;

export type RelevanceRankerContext = {
  bundle: InitiativeSignalBundle;
  facts?: ProactiveSignalFact[];
  urgency?: AdviceUrgency;
  llmOnline?: boolean;
  idleGateOpen?: boolean;
  loading?: boolean;
  adviceReady?: boolean;
  smalltalkReady?: boolean;
  toneSnapshot?: ProactiveToneSnapshot;
  recentAdviceStreak?: number;
};

export type RankedRelevanceCandidate<T extends string = RelevanceCandidateKind> = {
  kind: T;
  score: number;
  baseScore: number;
  features: RelevanceFeatureVector;
  reasons: string[];
};

type WeightTable = Partial<
  Record<RelevanceCandidateKind, Partial<Record<RelevanceFeatureKey, number>>>
>;

const STORAGE_KEY = "desktop-character.relevance-ranker.v1";
const EVENTS_KEY = "desktop-character.relevance-ranker-events.v1";
const LEARNING_RATE = 0.06;
const PASSIVE_LEARNING_RATE_MULTIPLIER = 0.55;
const WEIGHT_LIMIT = 3;
const MAX_LEARNING_EVENTS = 40;

export type RelevanceOutcomeLabel =
  | "helped"
  | "ignored"
  | "stale"
  | "interrupted"
  | "resolved";

export type RelevanceOutcomeRecordLike = {
  candidateKind?: string;
  outcome?: RelevanceOutcomeLabel;
  confidence?: number;
  reason?: string;
  beforeState?: {
    processName?: string;
    windowTitle?: string;
    editorFile?: string;
    taskTitle?: string;
    factIds?: string[];
    factSummary?: string;
    hasErrorSignal?: boolean;
    stuckScore?: number;
    openTaskCount?: number;
    breakDue?: boolean;
  };
};

type RelevanceLearningSource = "explicit_feedback" | "passive_outcome";

type RelevanceLearningEvent = {
  at: number;
  source: RelevanceLearningSource;
  kind: string;
  label: string;
  target: number;
  scoreBefore: number;
  reason: string;
  features: string[];
};

const DEFAULT_WEIGHTS: WeightTable = {
  try_advice: {
    bias: -0.15,
    toolIde: 0.35,
    toolTerminal: 0.5,
    clipboard: 0.4,
    clipboardRich: 0.85,
    clipboardDiagnostic: 0.9,
    terminalError: 0.9,
    inputFriction: 0.35,
    stuck: 0.55,
    query: 0.25,
    task: 0.2,
    adviceReady: 1.1,
    smalltalkReady: -0.15,
    recentAdviceStreak: -0.45,
    smalltalkSkew: 0.45,
    adviceSkew: -0.5,
    llmOnline: 0.25,
    busy: -0.2,
    candidateAdvice: 0.45,
  },
  try_smalltalk: {
    bias: 0.05,
    toolIde: -0.12,
    clipboardRich: -0.55,
    clipboardDiagnostic: -0.75,
    terminalError: -0.8,
    inputFriction: -0.25,
    stuck: -0.35,
    breakDue: 0.25,
    smalltalkReady: 1,
    adviceReady: -0.25,
    recentAdviceStreak: 0.8,
    adviceSkew: 0.6,
    smalltalkSkew: -0.7,
    busy: -0.2,
    candidateSmalltalk: 0.45,
  },
  silent: {
    bias: -0.55,
    busy: 1.15,
    llmOnline: -0.1,
    adviceReady: -0.25,
    smalltalkReady: -0.25,
    recentAdviceStreak: 0.1,
    candidateSilent: 0.25,
  },
  debug_next_step: {
    bias: 0.1,
    toolIde: 0.25,
    clipboard: 0.2,
    clipboardRich: 0.75,
    clipboardDiagnostic: 0.85,
    terminalError: 0.85,
    inputFriction: 0.4,
    stuck: 0.5,
    candidateDebug: 0.55,
    candidateClipboard: 0.3,
    breakDue: -0.45,
  },
  terminal_error_triage: {
    bias: 0.08,
    toolTerminal: 0.35,
    clipboardDiagnostic: 0.85,
    terminalError: 0.9,
    candidateDebug: 0.6,
    candidateClipboard: 0.3,
    breakDue: -0.5,
  },
  test_failure_triage: {
    bias: 0.08,
    terminalError: 0.75,
    candidateDebug: 0.6,
    breakDue: -0.45,
  },
  docs_to_code_bridge: {
    bias: 0,
    toolIde: 0.25,
    query: 0.5,
    candidateDocs: 0.55,
  },
  solution_lookup: {
    bias: 0.08,
    query: 0.3,
    clipboardDiagnostic: 0.35,
    candidateDocs: 0.65,
  },
  docs_lookup: {
    bias: -0.02,
    query: 0.45,
    candidateDocs: 0.5,
  },
  task_bridge: {
    bias: 0,
    task: 0.6,
    candidateTask: 0.55,
  },
  clarifying_probe: {
    bias: -0.05,
    clipboardRich: -0.45,
    clipboardDiagnostic: -0.55,
    terminalError: -0.5,
    query: 0.15,
    candidateClarify: 0.45,
    recentAdviceStreak: 0.2,
  },
  uncertainty_probe: {
    bias: -0.08,
    candidateClarify: 0.4,
    recentAdviceStreak: 0.15,
  },
  rest: {
    bias: -0.05,
    breakDue: 0.75,
    clipboardRich: -0.85,
    clipboardDiagnostic: -0.9,
    terminalError: -0.9,
    inputFriction: -0.5,
    candidateRest: 0.55,
  },
  refocus: {
    bias: -0.04,
    inputFriction: 0.15,
    recentAdviceStreak: -0.25,
    candidateRefocus: 0.5,
  },
  scope_cut: {
    bias: 0,
    task: 0.25,
    candidateTask: 0.35,
  },
  memory_pattern: {
    bias: 0.02,
  },
  stale_context_warning: {
    bias: -0.03,
    task: 0.3,
    candidateClarify: 0.2,
  },
};

const BASE_CANDIDATE_KINDS = new Set<string>([
  "try_advice",
  "try_smalltalk",
  "silent",
]);

let weightsCache: WeightTable | null = null;
let lastRankingSnapshot:
  | {
      at: number;
      candidates: RankedRelevanceCandidate[];
      winner?: string;
    }
  | null = null;

function loadWeights(): WeightTable {
  if (weightsCache) {
    return weightsCache;
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as
      | WeightTable
      | null;
    weightsCache = parsed ? mergeWeights(DEFAULT_WEIGHTS, parsed) : DEFAULT_WEIGHTS;
  } catch {
    weightsCache = DEFAULT_WEIGHTS;
  }
  return weightsCache;
}

function readLearningEvents(): RelevanceLearningEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(EVENTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((event): event is RelevanceLearningEvent =>
        Boolean(
          event &&
            typeof event === "object" &&
            typeof (event as RelevanceLearningEvent).at === "number" &&
            typeof (event as RelevanceLearningEvent).kind === "string" &&
            typeof (event as RelevanceLearningEvent).label === "string",
        ),
      )
      .slice(0, MAX_LEARNING_EVENTS);
  } catch {
    return [];
  }
}

function appendLearningEvent(event: RelevanceLearningEvent): void {
  try {
    localStorage.setItem(
      EVENTS_KEY,
      JSON.stringify([event, ...readLearningEvents()].slice(0, MAX_LEARNING_EVENTS)),
    );
  } catch {
    // Diagnostics are best-effort; scoring should survive storage failures.
  }
}

function saveWeights(weights: WeightTable): void {
  weightsCache = weights;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(weights));
  try {
    window.dispatchEvent(new Event("ari-proactive-state-changed"));
  } catch {
    // tests may not provide window events
  }
}

function mergeWeights(base: WeightTable, learned: WeightTable): WeightTable {
  const merged: WeightTable = { ...base };
  for (const [kind, values] of Object.entries(learned) as Array<
    [RelevanceCandidateKind, Partial<Record<RelevanceFeatureKey, number>>]
  >) {
    merged[kind] = { ...(base[kind] ?? {}), ...values };
  }
  return merged;
}

function dot(
  weights: Partial<Record<RelevanceFeatureKey, number>> | undefined,
  features: RelevanceFeatureVector,
): number {
  let score = 0;
  for (const [key, value] of Object.entries(features) as Array<
    [RelevanceFeatureKey, number]
  >) {
    score += (weights?.[key] ?? 0) * value;
  }
  return score;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clipWeight(value: number): number {
  return Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, value));
}

function normalizeRelevanceKind(
  kind?: string,
  fallback?: RelevanceCandidateKind,
): RelevanceCandidateKind | undefined {
  if (
    kind &&
    (BASE_CANDIDATE_KINDS.has(kind) ||
      Object.prototype.hasOwnProperty.call(DEFAULT_WEIGHTS, kind))
  ) {
    return kind as RelevanceCandidateKind;
  }
  return fallback;
}

function processHints(bundle: InitiativeSignalBundle): {
  toolIde: number;
  toolTerminal: number;
  toolBrowser: number;
} {
  const process = [
    bundle.window?.processName,
    bundle.advisor.currentProcess,
    bundle.advisor.currentTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    toolIde: /cursor|code|devenv|idea|webstorm|pycharm|rider|sublime|notepad\+\+/.test(
      process,
    )
      ? 1
      : 0,
    toolTerminal: /terminal|powershell|cmd|pwsh|wezterm|windows terminal|alacritty/.test(
      process,
    )
      ? 1
      : 0,
    toolBrowser: /chrome|edge|firefox|browser|opera|brave/.test(process) ? 1 : 0,
  };
}

function clipboardStats(
  bundle: InitiativeSignalBundle,
  facts: ProactiveSignalFact[] = [],
): {
  clipboard: number;
  clipboardRich: number;
  clipboardDiagnostic: number;
  terminalError: number;
} {
  const clipTexts = [
    ...bundle.clipboardSnippets.map((clip) => clip.text),
    ...facts.filter((fact) => fact.kind === "clipboard").map((fact) => fact.detail),
  ];
  const joined = clipTexts.join("\n");
  const hasClipboard = clipTexts.length > 0;
  const rich = clipTexts.some(isClipboardSemanticallyRich);
  const diagnostic =
    bundle.clipboardSnippets.some((clip) =>
      ["stacktrace", "diagnostic"].includes(clip.kind),
    ) ||
    /error|exception|failed|cannot|denied|not found|traceback|panic|ошиб/i.test(
      joined,
    );
  return {
    clipboard: hasClipboard ? 1 : 0,
    clipboardRich: rich ? 1 : 0,
    clipboardDiagnostic: diagnostic ? 1 : 0,
    terminalError:
      diagnostic || Boolean(bundle.advisor.repeatedErrorSignature) ? 1 : 0,
  };
}

function candidateFeatures(kind: RelevanceCandidateKind): RelevanceFeatureVector {
  const features: RelevanceFeatureVector = {};
  if (kind === "try_advice") features.candidateAdvice = 1;
  if (kind === "try_smalltalk") features.candidateSmalltalk = 1;
  if (kind === "silent") features.candidateSilent = 1;
  if (
    kind === "debug_next_step" ||
    kind === "terminal_error_triage" ||
    kind === "test_failure_triage"
  ) {
    features.candidateDebug = 1;
  }
  if (kind === "clarifying_probe" || kind === "uncertainty_probe") {
    features.candidateClarify = 1;
  }
  if (kind === "rest") features.candidateRest = 1;
  if (kind === "docs_lookup" || kind === "docs_to_code_bridge" || kind === "solution_lookup") {
    features.candidateDocs = 1;
  }
  if (kind === "task_bridge" || kind === "scope_cut") features.candidateTask = 1;
  if (kind === "refocus") features.candidateRefocus = 1;
  return features;
}

function candidateHasClipboardEvidence(
  candidate?: AdviceCandidate,
): boolean {
  return Boolean(
    candidate?.evidenceIds.some((id) => id.startsWith("clip:")) ||
      /буфер|clipboard/i.test(candidate?.actionText ?? ""),
  );
}

export function buildRelevanceFeatures(
  candidate: RelevanceCandidateKind,
  ctx: RelevanceRankerContext,
  adviceCandidate?: AdviceCandidate,
): RelevanceFeatureVector {
  const tools = processHints(ctx.bundle);
  const clip = clipboardStats(ctx.bundle, ctx.facts);
  const toneSnapshot = ctx.toneSnapshot;
  return {
    bias: 1,
    ...tools,
    ...clip,
    inputFriction: Math.min(
      1,
      ctx.bundle.advisor.activitySummary.inputFrictionScore / 3,
    ),
    stuck: Math.min(1, ctx.bundle.advisor.stuckScore),
    query: ctx.bundle.advisor.topQueryThemes.length > 0 ? 1 : 0,
    task: ctx.bundle.taskActivityLink?.confidence === "strong" ? 1 : 0,
    breakDue: ctx.bundle.advisor.breakDue ? 1 : 0,
    adviceReady: ctx.adviceReady ? 1 : 0,
    smalltalkReady: ctx.smalltalkReady ? 1 : 0,
    recentAdviceStreak: Math.min(1, (ctx.recentAdviceStreak ?? 0) / 2),
    adviceSkew:
      toneSnapshot && toneSnapshot.adviceToday > toneSnapshot.smalltalkToday + 1
        ? 1
        : 0,
    smalltalkSkew:
      toneSnapshot && toneSnapshot.smalltalkToday > toneSnapshot.adviceToday + 1
        ? 1
        : 0,
    llmOnline: ctx.llmOnline === false ? 0 : 1,
    busy: ctx.loading || ctx.idleGateOpen === false ? 1 : 0,
    ...candidateFeatures(candidate),
    candidateClipboard: candidateHasClipboardEvidence(adviceCandidate) ? 1 : 0,
  };
}

function relevanceReasons(features: RelevanceFeatureVector): string[] {
  const reasons: string[] = [];
  if (features.toolIde) reasons.push("IDE");
  if (features.toolTerminal) reasons.push("terminal");
  if (features.clipboardRich) reasons.push("clipboard rich");
  else if (features.clipboardDiagnostic) reasons.push("clipboard diagnostic");
  else if (features.clipboard) reasons.push("clipboard");
  if (features.inputFriction) reasons.push("input friction");
  if (features.stuck) reasons.push("stuck");
  if (features.query) reasons.push("query");
  if (features.breakDue) reasons.push("break due");
  if (features.recentAdviceStreak) reasons.push("advice streak");
  if (features.busy) reasons.push("busy");
  return reasons;
}

export function scoreRelevanceCandidate(
  kind: RelevanceCandidateKind,
  ctx: RelevanceRankerContext,
  adviceCandidate?: AdviceCandidate,
): RankedRelevanceCandidate {
  const features = buildRelevanceFeatures(kind, ctx, adviceCandidate);
  const baseScore = dot(loadWeights()[kind], features);
  return {
    kind,
    score: sigmoid(baseScore),
    baseScore,
    features,
    reasons: relevanceReasons(features),
  };
}

export function rankRelevanceCandidates<T extends RelevanceCandidateKind>(
  candidates: T[],
  ctx: RelevanceRankerContext,
): RankedRelevanceCandidate<T>[] {
  const ranked = candidates
    .map((kind) => scoreRelevanceCandidate(kind, ctx) as RankedRelevanceCandidate<T>)
    .sort((left, right) => right.score - left.score);
  lastRankingSnapshot = {
    at: Date.now(),
    candidates: ranked,
    winner: ranked[0]?.kind,
  };
  return ranked;
}

function scoreToCandidateBonus(score: number): number {
  return Math.max(-0.35, Math.min(0.35, (score - 0.5) * 0.7));
}

export function rerankAdviceCandidates(
  candidates: AdviceCandidate[],
  ctx: RelevanceRankerContext,
): AdviceCandidate[] {
  return candidates
    .map((candidate) => {
      const rank = scoreRelevanceCandidate(candidate.kind, ctx, candidate);
      return {
        ...candidate,
        score: candidate.score + scoreToCandidateBonus(rank.score),
      };
    })
    .sort((left, right) => right.score - left.score);
}

function feedbackTarget(feedback: AdviceFeedback): number {
  return feedback === "useful" ? 1 : 0;
}

function feedbackLabel(feedback: AdviceFeedback): string {
  switch (feedback) {
    case "useful":
      return "useful";
    case "not_now":
      return "not_now";
    case "miss":
      return "miss";
    case "too_generic":
      return "too_generic";
  }
}

function featuresFromLedger(entry: AdviceLedgerEntry): RelevanceFeatureVector {
  const text = [
    entry.anchor,
    entry.signalSummary,
    entry.linkNarrative,
    entry.practicalHook,
    entry.replyText,
  ]
    .filter(Boolean)
    .join("\n");
  const kind = (entry.adviceCandidateKind ??
    entry.initiativeMove ??
    (entry.tone === "smalltalk" ? "try_smalltalk" : "try_advice")) as
    | RelevanceCandidateKind
    | undefined;
  return {
    bias: 1,
    clipboard: /буфер|clipboard/i.test(text) ? 1 : 0,
    clipboardRich: isClipboardSemanticallyRich(text) ? 1 : 0,
    clipboardDiagnostic: /error|exception|failed|ошиб|traceback|panic/i.test(text)
      ? 1
      : 0,
    terminalError: /error|exception|failed|ошиб|traceback|panic/i.test(text)
      ? 1
      : 0,
    toolIde: /\.tsx?|\.jsx?|\.rs|\.py|cursor|ide/i.test(text) ? 1 : 0,
    query: /поиск|query|docs|rag|http/i.test(text) ? 1 : 0,
    task: /задач|цель|task/i.test(text) ? 1 : 0,
    breakDue: /перерыв|отдох|пауза/i.test(text) ? 1 : 0,
    ...(kind ? candidateFeatures(kind) : {}),
  };
}

function featuresFromOutcomeRecord(
  record: RelevanceOutcomeRecordLike,
  kind: RelevanceCandidateKind,
): RelevanceFeatureVector {
  const state = record.beforeState;
  const factIds = state?.factIds ?? [];
  const text = [
    state?.factSummary,
    state?.processName,
    state?.windowTitle,
    state?.editorFile,
    state?.taskTitle,
    factIds.join(" "),
    record.reason,
  ]
    .filter(Boolean)
    .join("\n");
  const toolText = [
    state?.processName,
    state?.windowTitle,
    state?.editorFile,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hasClipboard =
    factIds.some((id) => id.startsWith("clip:")) || /буфер|clipboard|clip:/i.test(text);
  const hasDiagnostic =
    Boolean(state?.hasErrorSignal) ||
    /error|exception|failed|cannot|denied|not found|traceback|panic|ошиб/i.test(
      text,
    );
  return {
    bias: 1,
    toolIde:
      /cursor|code|devenv|idea|webstorm|pycharm|rider|sublime|notepad\+\+/.test(
        toolText,
      ) || /\.[tj]sx?|\.jsx?|\.rs|\.py|\.md|\.json/i.test(state?.editorFile ?? "")
        ? 1
        : 0,
    toolTerminal:
      /terminal|powershell|cmd|pwsh|wezterm|windows terminal|alacritty/.test(
        toolText,
      )
        ? 1
        : 0,
    toolBrowser: /chrome|edge|firefox|browser|opera|brave/.test(toolText) ? 1 : 0,
    clipboard: hasClipboard ? 1 : 0,
    clipboardRich: isClipboardSemanticallyRich(text) ? 1 : 0,
    clipboardDiagnostic: hasClipboard && hasDiagnostic ? 1 : 0,
    terminalError: hasDiagnostic ? 1 : 0,
    stuck: Math.min(1, Math.max(0, state?.stuckScore ?? 0)),
    query: /поиск|query|docs|rag|http|api|stackoverflow|google/i.test(text) ? 1 : 0,
    task: state?.openTaskCount || state?.taskTitle ? 1 : 0,
    breakDue: state?.breakDue ? 1 : 0,
    candidateClipboard: hasClipboard ? 1 : 0,
    ...candidateFeatures(kind),
  };
}

function trainingTargetFromOutcome(
  outcome: RelevanceOutcomeLabel,
): { target: number; strength: number } {
  switch (outcome) {
    case "resolved":
      return { target: 1, strength: 0.8 };
    case "helped":
      return { target: 0.82, strength: 0.55 };
    case "ignored":
      return { target: 0.18, strength: 0.45 };
    case "stale":
      return { target: 0.08, strength: 0.6 };
    case "interrupted":
      return { target: 0.02, strength: 0.75 };
  }
}

function activeFeatureKeys(features: RelevanceFeatureVector): string[] {
  return (Object.entries(features) as Array<[RelevanceFeatureKey, number]>)
    .filter(([, value]) => Math.abs(value) > 0.001)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 8)
    .map(([key, value]) =>
      value === 1 ? key : `${key}:${Number(value.toFixed(2))}`,
    );
}

function applyRelevanceUpdate(input: {
  kind: RelevanceCandidateKind;
  features: RelevanceFeatureVector;
  target: number;
  source: RelevanceLearningSource;
  label: string;
  reason: string;
  strength?: number;
}): void {
  const weights = loadWeights();
  const current = { ...(weights[input.kind] ?? {}) };
  const prediction = sigmoid(dot(current, input.features));
  const error = prediction - input.target;
  const rate =
    LEARNING_RATE * Math.max(0, Math.min(1, input.strength ?? 1));
  for (const [key, value] of Object.entries(input.features) as Array<
    [RelevanceFeatureKey, number]
  >) {
    if (Math.abs(value) <= 0.001) {
      continue;
    }
    current[key] = clipWeight((current[key] ?? 0) - rate * error * value);
  }
  saveWeights({ ...weights, [input.kind]: current });
  appendLearningEvent({
    at: Date.now(),
    source: input.source,
    kind: input.kind,
    label: input.label,
    target: input.target,
    scoreBefore: prediction,
    reason: input.reason,
    features: activeFeatureKeys(input.features),
  });
}

export function recordRelevanceFeedback(
  entry: AdviceLedgerEntry,
  feedback: AdviceFeedback,
): void {
  const fallback = entry.tone === "smalltalk" ? "try_smalltalk" : "try_advice";
  const kind = normalizeRelevanceKind(
    entry.adviceCandidateKind ?? entry.initiativeMove,
    fallback,
  );
  if (!kind) {
    return;
  }
  applyRelevanceUpdate({
    kind,
    features: featuresFromLedger(entry),
    target: feedbackTarget(feedback),
    source: "explicit_feedback",
    label: feedbackLabel(feedback),
    reason: entry.practicalHook ?? entry.signalSummary ?? "explicit feedback",
  });
}

export function recordRelevanceOutcome(
  record: RelevanceOutcomeRecordLike,
): void {
  if (!record.outcome) {
    return;
  }
  const kind = normalizeRelevanceKind(record.candidateKind, "try_advice");
  if (!kind) {
    return;
  }
  const training = trainingTargetFromOutcome(record.outcome);
  const confidence = Math.max(0.25, Math.min(1, record.confidence ?? 0.5));
  applyRelevanceUpdate({
    kind,
    features: featuresFromOutcomeRecord(record, kind),
    target: training.target,
    source: "passive_outcome",
    label: record.outcome,
    reason: record.reason ?? "passive outcome",
    strength: training.strength * confidence * PASSIVE_LEARNING_RATE_MULTIPLIER,
  });
}

export function resetRelevanceRankerForTests(): void {
  weightsCache = null;
  lastRankingSnapshot = null;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(EVENTS_KEY);
}

export function describeRelevanceRankerForDiagnostics(): {
  winner: string;
  scores: string[];
  learnedEvents: number;
  lastUpdate: string | null;
  recentUpdates: string[];
} {
  const events = readLearningEvents();
  const recentUpdates = events.slice(0, 3).map((event) => {
    const direction = event.target >= 0.5 ? "positive" : "negative";
    return `${event.kind} ${direction} ${event.label} (${event.scoreBefore.toFixed(2)}→${event.target.toFixed(2)})`;
  });
  if (!lastRankingSnapshot) {
    return {
      winner: "—",
      scores: [],
      learnedEvents: events.length,
      lastUpdate: recentUpdates[0] ?? null,
      recentUpdates,
    };
  }
  return {
    winner: lastRankingSnapshot.winner ?? "—",
    scores: lastRankingSnapshot.candidates
      .slice(0, 4)
      .map(
        (candidate) =>
          `${candidate.kind} ${candidate.score.toFixed(2)} (${candidate.reasons.join(", ") || "base"})`,
      ),
    learnedEvents: events.length,
    lastUpdate: recentUpdates[0] ?? null,
    recentUpdates,
  };
}
