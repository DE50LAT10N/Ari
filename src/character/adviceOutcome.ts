import type { AdviceFeedback, AdviceLedgerEntry } from "./adviceLedger";
import type { AdviceCandidateKind } from "./advicePlanner";
import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";
import { recordRelevanceOutcome } from "./relevanceRanker";

export type AdviceOutcome =
  | "helped"
  | "ignored"
  | "stale"
  | "interrupted"
  | "resolved";

export type AdviceObservedState = {
  at: number;
  topicKey: string;
  processName?: string;
  windowTitle?: string;
  editorFile?: string;
  taskTitle?: string;
  factIds: string[];
  factSummary: string;
  hasErrorSignal: boolean;
  stuckScore: number;
  openTaskCount: number;
  breakDue: boolean;
};

export type AdviceOutcomeRecord = {
  adviceId: string;
  topicKey: string;
  candidateKind?: AdviceCandidateKind | string;
  beforeState: AdviceObservedState;
  afterState?: AdviceObservedState;
  outcome?: AdviceOutcome;
  confidence: number;
  reason: string;
  detectedAt?: number;
  expiresAt: number;
};

const OUTCOME_KEY = "desktop-character.advice-outcomes.v1";
const OUTCOME_TTL_MS = 7 * 24 * 60 * 60_000;
const PENDING_MIN_AGE_MS = 4 * 60_000;
const PENDING_MAX_AGE_MS = 45 * 60_000;
const MAX_OUTCOMES = 60;

export const ADVICE_IGNORED_EVENT = "ari-advice-ignored";

export type AdviceReconcileResult = {
  records: AdviceOutcomeRecord[];
  newlyIgnored: number;
};

export type AdviceOutcomeReputation = {
  sampleSize: number;
  positive: number;
  negative: number;
  score: number;
  intervalMultiplier: number;
  confidenceBonus: number;
  label: "unknown" | "trusted" | "cautious" | "mixed";
  reasons: string[];
};

function readOutcomes(now = Date.now()): AdviceOutcomeRecord[] {
  try {
    const raw = localStorage.getItem(OUTCOME_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const pruned = parsed
      .filter((entry): entry is AdviceOutcomeRecord =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            typeof (entry as AdviceOutcomeRecord).adviceId === "string" &&
            typeof (entry as AdviceOutcomeRecord).topicKey === "string" &&
            typeof (entry as AdviceOutcomeRecord).expiresAt === "number" &&
            now < (entry as AdviceOutcomeRecord).expiresAt,
        ),
      )
      .sort(
        (left, right) =>
          (right.detectedAt ?? right.beforeState.at) -
          (left.detectedAt ?? left.beforeState.at),
      )
      .slice(0, MAX_OUTCOMES);
    if (pruned.length !== parsed.length) {
      localStorage.setItem(OUTCOME_KEY, JSON.stringify(pruned));
    }
    return pruned;
  } catch {
    return [];
  }
}

function saveOutcomes(entries: AdviceOutcomeRecord[]): void {
  localStorage.setItem(
    OUTCOME_KEY,
    JSON.stringify(
      entries
        .sort(
          (left, right) =>
            (right.detectedAt ?? right.beforeState.at) -
            (left.detectedAt ?? left.beforeState.at),
        )
        .slice(0, MAX_OUTCOMES),
    ),
  );
}

function hasErrorFact(facts: ProactiveSignalFact[]): boolean {
  return facts.some(
    (fact) =>
      fact.kind === "clipboard" &&
      /error|exception|traceback|panic|failed|ошиб/i.test(fact.detail),
  );
}

export function buildAdviceObservedState(input: {
  topicKey: string;
  bundle: InitiativeSignalBundle;
  facts: ProactiveSignalFact[];
  processName?: string;
  windowTitle?: string;
  now?: number;
}): AdviceObservedState {
  const factSummary = input.facts
    .slice(0, 5)
    .map((fact) => `${fact.kind}:${fact.detail}`)
    .join(" | ");
  return {
    at: input.now ?? Date.now(),
    topicKey: input.topicKey,
    processName: input.processName ?? input.bundle.window?.processName,
    windowTitle: input.windowTitle ?? input.bundle.window?.title,
    editorFile: input.bundle.editorFile,
    taskTitle:
      input.bundle.taskActivityLink?.taskTitle ?? input.bundle.nextTaskTitle,
    factIds: input.facts.map((fact) => fact.id).slice(0, 10),
    factSummary: factSummary.slice(0, 500),
    hasErrorSignal:
      hasErrorFact(input.facts) ||
      Boolean(input.bundle.advisor.repeatedErrorSignature),
    stuckScore: input.bundle.advisor.stuckScore,
    openTaskCount: input.bundle.advisor.openTaskCount,
    breakDue: input.bundle.advisor.breakDue,
  };
}

export function startAdviceOutcomeObservation(input: {
  adviceId: string;
  topicKey: string;
  candidateKind?: AdviceCandidateKind | string;
  beforeState: AdviceObservedState;
  now?: number;
}): AdviceOutcomeRecord {
  const now = input.now ?? Date.now();
  const entries = readOutcomes(now).filter(
    (entry) => entry.adviceId !== input.adviceId,
  );
  const record: AdviceOutcomeRecord = {
    adviceId: input.adviceId,
    topicKey: input.topicKey,
    candidateKind: input.candidateKind,
    beforeState: input.beforeState,
    confidence: 0,
    reason: "ожидает следующего состояния",
    expiresAt: now + OUTCOME_TTL_MS,
  };
  saveOutcomes([record, ...entries]);
  return record;
}

function feedbackToOutcome(feedback: AdviceFeedback): {
  outcome: AdviceOutcome;
  confidence: number;
  reason: string;
} {
  switch (feedback) {
    case "useful":
      return {
        outcome: "helped",
        confidence: 0.95,
        reason: "пользователь отметил совет как полезный",
      };
    case "not_now":
      return {
        outcome: "interrupted",
        confidence: 0.88,
        reason: "пользователь отметил, что совет был не вовремя",
      };
    case "miss":
      return {
        outcome: "stale",
        confidence: 0.88,
        reason: "пользователь отметил промах по контексту",
      };
    case "too_generic":
      return {
        outcome: "ignored",
        confidence: 0.82,
        reason: "пользователь отметил слишком общий совет",
      };
  }
}

export function recordAdviceFeedbackOutcome(
  entry: AdviceLedgerEntry,
  feedback: AdviceFeedback,
  now = Date.now(),
): AdviceOutcomeRecord {
  const verdict = feedbackToOutcome(feedback);
  const entries = readOutcomes(now);
  const existing = entries.find((item) => item.adviceId === entry.id);
  const record: AdviceOutcomeRecord = {
    adviceId: entry.id,
    topicKey: entry.topicKey,
    candidateKind: entry.adviceCandidateKind ?? entry.initiativeMove,
    beforeState:
      existing?.beforeState ??
      ({
        at: entry.at,
        topicKey: entry.topicKey,
        factIds: [],
        factSummary:
          entry.signalSummary ??
          entry.linkNarrative ??
          entry.practicalHook ??
          entry.replyText?.slice(0, 180) ??
          "",
        hasErrorSignal: /error|exception|traceback|ошиб/i.test(
          [
            entry.signalSummary,
            entry.linkNarrative,
            entry.practicalHook,
            entry.replyText,
          ]
            .filter(Boolean)
            .join(" "),
        ),
        stuckScore: 0,
        openTaskCount: 0,
        breakDue: false,
      } satisfies AdviceObservedState),
    afterState: existing?.afterState,
    outcome: verdict.outcome,
    confidence: verdict.confidence,
    reason: verdict.reason,
    detectedAt: now,
    expiresAt: now + OUTCOME_TTL_MS,
  };
  saveOutcomes([record, ...entries.filter((item) => item.adviceId !== entry.id)]);
  return record;
}

function sameTopic(before: AdviceObservedState, after: AdviceObservedState): boolean {
  return before.topicKey === after.topicKey;
}

function overlappingFacts(
  before: AdviceObservedState,
  after: AdviceObservedState,
): number {
  const afterIds = new Set(after.factIds);
  return before.factIds.filter((id) => afterIds.has(id)).length;
}

function inferPassiveOutcome(
  record: AdviceOutcomeRecord,
  afterState: AdviceObservedState,
  now: number,
): AdviceOutcomeRecord | null {
  const age = now - record.beforeState.at;
  if (record.outcome || age < PENDING_MIN_AGE_MS) {
    return null;
  }

  const before = record.beforeState;
  const overlap = overlappingFacts(before, afterState);
  const topicContinued = sameTopic(before, afterState) || overlap > 0;
  const errorCleared = before.hasErrorSignal && !afterState.hasErrorSignal;
  const stuckReduced =
    before.stuckScore >= 0.45 &&
    afterState.stuckScore + 0.12 < before.stuckScore;
  const taskContinued =
    before.taskTitle &&
    afterState.taskTitle &&
    before.taskTitle === afterState.taskTitle;
  const movedAway = !sameTopic(before, afterState) && overlap === 0;

  if (errorCleared || stuckReduced) {
    return {
      ...record,
      afterState,
      outcome: "resolved",
      confidence: errorCleared ? 0.74 : 0.66,
      reason: errorCleared
        ? "ошибочный сигнал исчез после совета"
        : "stuck-сигнал стал слабее после совета",
      detectedAt: now,
    };
  }

  if (
    topicContinued &&
    (taskContinued ||
      afterState.editorFile === before.editorFile ||
      record.candidateKind === "refocus" ||
      record.candidateKind === "scope_cut")
  ) {
    return {
      ...record,
      afterState,
      outcome: "helped",
      confidence: 0.58,
      reason: "после совета работа продолжилась в той же теме",
      detectedAt: now,
    };
  }

  if (movedAway && age <= PENDING_MAX_AGE_MS) {
    return {
      ...record,
      afterState,
      outcome: "stale",
      confidence: 0.52,
      reason: "после совета контекст быстро ушёл в другую тему",
      detectedAt: now,
    };
  }

  if (age >= PENDING_MAX_AGE_MS) {
    return {
      ...record,
      afterState,
      outcome: "ignored",
      confidence: 0.5,
      reason: "совет долго не получил признаков продолжения или решения",
      detectedAt: now,
    };
  }

  return null;
}

export function reconcilePendingAdviceOutcomes(input: {
  afterState: AdviceObservedState;
  now?: number;
}): AdviceReconcileResult {
  const now = input.now ?? Date.now();
  const entries = readOutcomes(now);
  let changed = false;
  let newlyIgnored = 0;
  const newlyInferred: AdviceOutcomeRecord[] = [];
  const next = entries.map((entry) => {
    const inferred = inferPassiveOutcome(entry, input.afterState, now);
    if (inferred) {
      changed = true;
      newlyInferred.push(inferred);
      if (
        !entry.outcome &&
        (inferred.outcome === "ignored" || inferred.outcome === "stale")
      ) {
        newlyIgnored += 1;
      }
      return inferred;
    }
    return entry;
  });
  if (changed) {
    saveOutcomes(next);
  }
  for (const inferred of newlyInferred) {
    recordRelevanceOutcome(inferred);
  }
  if (newlyIgnored > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(ADVICE_IGNORED_EVENT, {
        detail: { count: newlyIgnored },
      }),
    );
  }
  return {
    records: next.filter((entry) => entry.outcome),
    newlyIgnored,
  };
}

export function getRecentAdviceOutcomes(
  topicKey?: string,
  now = Date.now(),
): AdviceOutcomeRecord[] {
  return readOutcomes(now)
    .filter((entry) => entry.outcome)
    .filter((entry) => (topicKey ? entry.topicKey === topicKey : true))
    .slice(0, 8);
}

function outcomeWeight(outcome: AdviceOutcome): number {
  switch (outcome) {
    case "helped":
      return 0.55;
    case "resolved":
      return 0.75;
    case "ignored":
      return -0.55;
    case "stale":
      return -0.45;
    case "interrupted":
      return -0.35;
  }
}

export function summarizeAdviceOutcomeReputation(input?: {
  topicKey?: string;
  now?: number;
  limit?: number;
}): AdviceOutcomeReputation {
  const outcomes = getRecentAdviceOutcomes(input?.topicKey, input?.now).slice(
    0,
    input?.limit ?? 8,
  );
  if (!outcomes.length) {
    return {
      sampleSize: 0,
      positive: 0,
      negative: 0,
      score: 0,
      intervalMultiplier: 1,
      confidenceBonus: 0,
      label: "unknown",
      reasons: [],
    };
  }

  let weighted = 0;
  let totalWeight = 0;
  let positive = 0;
  let negative = 0;
  for (const [index, entry] of outcomes.entries()) {
    if (!entry.outcome) continue;
    const recency = 1 / (1 + index * 0.35);
    const confidence = Math.max(0.3, Math.min(1, entry.confidence));
    const weight = recency * confidence;
    const value = outcomeWeight(entry.outcome);
    weighted += value * weight;
    totalWeight += weight;
    if (value > 0) positive += 1;
    if (value < 0) negative += 1;
  }

  const score = totalWeight > 0 ? weighted / totalWeight : 0;
  const label =
    score >= 0.24
      ? "trusted"
      : score <= -0.2
        ? "cautious"
        : "mixed";
  const intervalMultiplier =
    label === "trusted" ? 0.82 : label === "cautious" ? 1.45 : 1;
  const confidenceBonus =
    label === "trusted" ? 0.8 : label === "cautious" ? -1.1 : 0;
  const reasons = [
    label === "trusted"
      ? `advice reputation: ${positive} helped/resolved recently`
      : label === "cautious"
        ? `advice reputation: ${negative} ignored/stale/interrupted recently`
        : `advice reputation: mixed ${positive}/${negative}`,
  ];

  return {
    sampleSize: outcomes.length,
    positive,
    negative,
    score,
    intervalMultiplier,
    confidenceBonus,
    label,
    reasons,
  };
}

export function describeAdviceOutcomesForPrompt(
  topicKey?: string,
  now = Date.now(),
): string {
  const outcomes = getRecentAdviceOutcomes(topicKey, now).slice(0, 4);
  if (!outcomes.length) {
    return "";
  }
  const labels: Record<AdviceOutcome, string> = {
    helped: "помогло",
    ignored: "проигнорировано",
    stale: "контекст устарел",
    interrupted: "было не вовремя",
    resolved: "похоже решено",
  };
  return [
    "Недавние последствия советов по этой теме:",
    ...outcomes.map(
      (entry) =>
        `- ${labels[entry.outcome!]} (${entry.candidateKind ?? "ход неизвестен"}): ${entry.reason}`,
    ),
    "Если прошлый ход был проигнорирован, не вовремя или устарел — смени тип совета и сделай его короче.",
    "Если прошлый ход помог или решил проблему — продолжай с места результата, не начинай заново.",
  ].join("\n");
}

export function resetAdviceOutcomesForTests(): void {
  localStorage.removeItem(OUTCOME_KEY);
}
