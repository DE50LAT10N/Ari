import type { AdviceCandidate, AdvicePlan } from "./advicePlanner";
import type { AdviceOutcomeRecord } from "./adviceOutcome";
import {
  summarizeWeightedAdviceOutcomes,
  type AdviceOutcomeWeightProfile,
} from "./adviceOutcomeScoring";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";

export type AdviceMoveKind =
  | "fix_error"
  | "explain_code"
  | "unstick_next_step"
  | "docs_lookup"
  | "scope_cut"
  | "task_bridge"
  | "ask_clarifying"
  | "take_break"
  | "memory_pattern";

export type AdviceMoveSelection = {
  move: AdviceMoveKind;
  candidate: AdviceCandidate | null;
  confidence: number;
  reputation?: AdviceMoveReputation;
  reasons: string[];
  disallowedGenericFallbacks: string[];
  promptGuidance: string;
};

export type AdviceMoveReputation = {
  move: AdviceMoveKind;
  sampleSize: number;
  positive: number;
  negative: number;
  score: number;
  label: "unknown" | "trusted" | "mixed" | "cautious" | "blocked";
  confidenceAdjustment: number;
  reasons: string[];
};

const GENERIC_FALLBACKS = [
  "do not suggest a break",
  "do not say to inspect comments",
  "do not ask the user to copy context again",
  "do not give a generic file overview",
];

const ALL_MOVES: AdviceMoveKind[] = [
  "fix_error",
  "explain_code",
  "unstick_next_step",
  "docs_lookup",
  "scope_cut",
  "task_bridge",
  "ask_clarifying",
  "take_break",
  "memory_pattern",
];

const MOVE_OUTCOME_WEIGHTS: AdviceOutcomeWeightProfile = {
  resolved: 0.85,
  helped: 0.65,
  interrupted: -0.55,
  stale: -0.5,
  ignored: -0.65,
};

function hasFact(
  facts: ProactiveSignalFact[],
  kind: ProactiveSignalFact["kind"],
  pattern?: RegExp,
): boolean {
  return facts.some(
    (fact) => fact.kind === kind && (!pattern || pattern.test(fact.detail)),
  );
}

export function candidateKindToAdviceMove(
  candidateKind?: string | null,
): AdviceMoveKind | null {
  switch (candidateKind) {
    case "terminal_error_triage":
    case "test_failure_triage":
      return "fix_error";
    case "docs_lookup":
    case "docs_to_code_bridge":
    case "solution_lookup":
      return "docs_lookup";
    case "scope_cut":
      return "scope_cut";
    case "task_bridge":
      return "task_bridge";
    case "clarifying_probe":
    case "uncertainty_probe":
      return "ask_clarifying";
    case "rest":
      return "take_break";
    case "memory_pattern":
      return "memory_pattern";
    case "refocus":
    case "stale_context_warning":
    case "debug_next_step":
      return "unstick_next_step";
    default:
      return null;
  }
}

function moveFromCandidate(
  candidate: AdviceCandidate | null,
  facts: ProactiveSignalFact[],
): AdviceMoveKind {
  if (!candidate) {
    return hasFact(facts, "clipboard") || hasFact(facts, "file")
      ? "ask_clarifying"
      : "unstick_next_step";
  }
  switch (candidate.kind) {
    case "terminal_error_triage":
    case "test_failure_triage":
      return "fix_error";
    case "docs_lookup":
    case "docs_to_code_bridge":
    case "solution_lookup":
      return "docs_lookup";
    case "scope_cut":
      return "scope_cut";
    case "task_bridge":
      return "task_bridge";
    case "clarifying_probe":
    case "uncertainty_probe":
      return "ask_clarifying";
    case "rest":
      return "take_break";
    case "memory_pattern":
      return "memory_pattern";
    case "debug_next_step":
      if (
        hasFact(facts, "clipboard", /error|exception|traceback|panic|failed|cannot|denied|not found|ошиб/i)
      ) {
        return "fix_error";
      }
      if (
        hasFact(facts, "clipboard", /function|const|class|import|def |=>|\{|\}/i) ||
        hasFact(facts, "code")
      ) {
        return "explain_code";
      }
      return "unstick_next_step";
    case "refocus":
    case "stale_context_warning":
      return "unstick_next_step";
  }
}

function genericFallbacksForMove(move: AdviceMoveKind): string[] {
  if (move === "ask_clarifying") {
    return ["do not suggest a break", "do not give a generic file overview"];
  }
  if (move === "take_break") {
    return [];
  }
  if (move === "scope_cut") {
    return ["do not suggest a break", "do not inspect comments"];
  }
  return GENERIC_FALLBACKS;
}

function guidanceForMove(move: AdviceMoveKind): string {
  switch (move) {
    case "fix_error":
      return "Advice move: fix_error. Extract the likely cause from the error/diagnostic, name one concrete fix or check, then give one verification step.";
    case "explain_code":
      return "Advice move: explain_code. Use concrete identifiers or structural elements from the clipboard/code and explain one actionable implication.";
    case "unstick_next_step":
      return "Advice move: unstick_next_step. Predict the nearest blocked step and give one small testable action, not a broad workflow tip.";
    case "docs_lookup":
      return "Advice move: docs_lookup. Bridge documentation/search/reference facts to the current file or error; include one concrete API/config/version check.";
    case "scope_cut":
      return "Advice move: scope_cut. Reduce the active scope to one task, one file, or one decision; do not turn it into a rest suggestion.";
    case "task_bridge":
      return "Advice move: task_bridge. Connect the visible work to the active task and propose one next step tied to that task.";
    case "ask_clarifying":
      return "Advice move: ask_clarifying. Ask one short, context-grounded question; quote the visible/clipboard/file anchor.";
    case "take_break":
      return "Advice move: take_break. Suggest rest only because the break signal is the selected move; keep it brief.";
    case "memory_pattern":
      return "Advice move: memory_pattern. Reuse a previously useful pattern, but adapt it to the fresh facts and avoid repeating wording.";
  }
}

function emptyMoveReputation(move: AdviceMoveKind): AdviceMoveReputation {
  return {
    move,
    sampleSize: 0,
    positive: 0,
    negative: 0,
    score: 0,
    label: "unknown",
    confidenceAdjustment: 0,
    reasons: [],
  };
}

export function summarizeAdviceMoveReputation(input: {
  move: AdviceMoveKind;
  outcomes?: AdviceOutcomeRecord[];
  limit?: number;
}): AdviceMoveReputation {
  const relevant = (input.outcomes ?? [])
    .filter((entry) => entry.outcome)
    .filter(
      (entry) => candidateKindToAdviceMove(entry.candidateKind) === input.move,
    )
    .slice(0, input.limit ?? 8);
  if (!relevant.length) {
    return emptyMoveReputation(input.move);
  }

  const { positive, negative, score } = summarizeWeightedAdviceOutcomes(
    relevant,
    MOVE_OUTCOME_WEIGHTS,
    input.limit ?? 8,
  );
  const label =
    negative >= 2 && score <= -0.4
      ? "blocked"
      : score >= 0.28
        ? "trusted"
        : score <= -0.22
          ? "cautious"
          : "mixed";
  const confidenceAdjustment =
    label === "trusted"
      ? 0.12
      : label === "cautious"
        ? -0.18
        : label === "blocked"
          ? -0.45
          : 0;

  return {
    move: input.move,
    sampleSize: relevant.length,
    positive,
    negative,
    score,
    label,
    confidenceAdjustment,
    reasons: [
      `move reputation ${input.move}: ${label} (${positive}/${negative}, score ${score.toFixed(2)})`,
    ],
  };
}

export function summarizeAdviceMoveReputations(
  outcomes: AdviceOutcomeRecord[],
): AdviceMoveReputation[] {
  return ALL_MOVES.map((move) =>
    summarizeAdviceMoveReputation({ move, outcomes }),
  ).filter((reputation) => reputation.sampleSize > 0);
}

function reputationRank(label: AdviceMoveReputation["label"]): number {
  switch (label) {
    case "trusted":
      return 3;
    case "unknown":
    case "mixed":
      return 2;
    case "cautious":
      return 1;
    case "blocked":
      return 0;
  }
}

function chooseCandidateWithReputation(input: {
  plan: AdvicePlan;
  facts: ProactiveSignalFact[];
  outcomes?: AdviceOutcomeRecord[];
}): { candidate: AdviceCandidate | null; move: AdviceMoveKind; rerouted: boolean } {
  const original = input.plan.selected;
  const originalMove = moveFromCandidate(original, input.facts);
  const originalReputation = summarizeAdviceMoveReputation({
    move: originalMove,
    outcomes: input.outcomes,
  });
  if (
    originalReputation.label !== "blocked" &&
    !(originalReputation.label === "cautious" && original?.kind === "clarifying_probe")
  ) {
    return { candidate: original, move: originalMove, rerouted: false };
  }

  const alternatives = input.plan.candidates
    .filter((candidate) => candidate.id !== original?.id)
    .map((candidate) => {
      const move = moveFromCandidate(candidate, input.facts);
      const reputation = summarizeAdviceMoveReputation({
        move,
        outcomes: input.outcomes,
      });
      return { candidate, move, reputation };
    })
    .filter(({ reputation }) => reputation.label !== "blocked")
    .sort((left, right) => {
      const reputationDelta =
        reputationRank(right.reputation.label) -
        reputationRank(left.reputation.label);
      if (reputationDelta !== 0) return reputationDelta;
      return right.candidate.score - left.candidate.score;
    });

  const alternative = alternatives[0];
  if (!alternative) {
    return { candidate: original, move: originalMove, rerouted: false };
  }
  return {
    candidate: alternative.candidate,
    move: alternative.move,
    rerouted: true,
  };
}

export function selectAdviceMove(input: {
  plan: AdvicePlan;
  facts: ProactiveSignalFact[];
  outcomes?: AdviceOutcomeRecord[];
}): AdviceMoveSelection {
  const choice = chooseCandidateWithReputation(input);
  const candidate = choice.candidate;
  const move = choice.move;
  const reputation = summarizeAdviceMoveReputation({
    move,
    outcomes: input.outcomes,
  });
  const disallowedGenericFallbacks = genericFallbacksForMove(move);
  const reasons = [
    candidate
      ? `candidate ${candidate.kind}: ${candidate.reason}`
      : input.plan.reason,
    `move ${move}`,
  ];
  if (choice.rerouted) {
    reasons.push("rerouted by move outcome learning");
  }
  if (reputation.sampleSize > 0) {
    reasons.push(...reputation.reasons);
  }
  if (disallowedGenericFallbacks.length > 0) {
    reasons.push(`generic fallback blocked: ${disallowedGenericFallbacks.join(", ")}`);
  }
  const confidence = Math.max(
    0,
    Math.min(1, (candidate?.confidence ?? 0.45) + reputation.confidenceAdjustment),
  );
  return {
    move,
    candidate,
    confidence,
    reputation,
    reasons,
    disallowedGenericFallbacks,
    promptGuidance: [
      guidanceForMove(move),
      reputation.sampleSize > 0
        ? `Move outcome learning: ${reputation.label}, score ${reputation.score.toFixed(2)}. ${
            reputation.label === "trusted"
              ? "You may be more direct."
              : reputation.label === "cautious" || reputation.label === "blocked"
                ? "Be more specific, shorter, and avoid repeating the same move shape."
                : "Do not overfit to mixed history."
          }`
        : "",
      disallowedGenericFallbacks.length
        ? `Forbidden generic fallbacks: ${disallowedGenericFallbacks.join("; ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function formatAdviceMoveForDiagnostics(
  selection: AdviceMoveSelection,
): string {
  return `${selection.move} · confidence ${selection.confidence.toFixed(2)} · ${
    selection.candidate?.kind ?? "no candidate"
  }`;
}
export function formatAdviceMoveReputationsForDiagnostics(
  outcomes: AdviceOutcomeRecord[],
  limit = 4,
): string[] {
  return summarizeAdviceMoveReputations(outcomes)
    .sort((left, right) => {
      if (left.label === "blocked" && right.label !== "blocked") return -1;
      if (right.label === "blocked" && left.label !== "blocked") return 1;
      return Math.abs(right.score) - Math.abs(left.score);
    })
    .slice(0, limit)
    .map(
      (entry) =>
        `${entry.move} ${entry.label} ${entry.score.toFixed(2)} (${entry.positive}/${entry.negative})`,
    );
}
