import { describe, expect, it } from "vitest";
import {
  formatAdviceMoveReputationsForDiagnostics,
  selectAdviceMove,
  summarizeAdviceMoveReputation,
} from "../src/character/adviceMoveSelector";
import type {
  AdviceCandidate,
  AdviceCandidateKind,
  AdvicePlan,
} from "../src/character/advicePlanner";
import type { AdviceOutcomeRecord } from "../src/character/adviceOutcome";
import type { ProactiveSignalFact } from "../src/character/proactiveLlmEngine";

function candidate(kind: AdviceCandidateKind, score = 1): AdviceCandidate {
  return {
    id: kind,
    kind,
    evidenceIds: ["clip:1"],
    actionText: "check the concrete thing",
    expectedUtility: 0.8,
    interruptionCost: 0.2,
    confidence: 0.7,
    reason: "test reason",
    score,
  };
}

function plan(kind: AdviceCandidateKind): AdvicePlan {
  const selected = candidate(kind);
  return {
    selected,
    candidates: [],
    reason: "selected",
  };
}

function multiPlan(selected: AdviceCandidate, candidates: AdviceCandidate[]): AdvicePlan {
  return {
    selected,
    candidates,
    reason: "selected",
  };
}

function fact(detail: string): ProactiveSignalFact {
  return {
    id: "clip:1",
    kind: "clipboard",
    label: "Clipboard",
    detail,
  };
}

function outcome(
  candidateKind: string,
  outcomeKind: AdviceOutcomeRecord["outcome"],
  index: number,
): AdviceOutcomeRecord {
  return {
    adviceId: `advice-${index}`,
    topicKey: "topic",
    candidateKind,
    beforeState: {
      at: index,
      topicKey: "topic",
      factIds: [],
      factSummary: "",
      hasErrorSignal: false,
      stuckScore: 0,
      openTaskCount: 0,
      breakDue: false,
    },
    outcome: outcomeKind,
    confidence: 0.9,
    reason: "test",
    detectedAt: index,
    expiresAt: Date.now() + 60_000,
  };
}

describe("adviceMoveSelector", () => {
  it("maps diagnostic debug candidates to fix_error and blocks generic fallbacks", () => {
    const selection = selectAdviceMove({
      plan: plan("debug_next_step"),
      facts: [fact("TypeError: Cannot read properties of undefined")],
    });

    expect(selection.move).toBe("fix_error");
    expect(selection.disallowedGenericFallbacks).toContain(
      "do not suggest a break",
    );
    expect(selection.promptGuidance).toContain("fix_error");
  });

  it("maps code-like clipboard debug candidates to explain_code", () => {
    const selection = selectAdviceMove({
      plan: plan("debug_next_step"),
      facts: [fact("Input{User message} --> Cmd{Chat command?}")],
    });

    expect(selection.move).toBe("explain_code");
    expect(selection.promptGuidance).toContain("concrete identifiers");
  });

  it("allows break wording only for the take_break move", () => {
    const selection = selectAdviceMove({
      plan: plan("rest"),
      facts: [],
    });

    expect(selection.move).toBe("take_break");
    expect(selection.disallowedGenericFallbacks).toEqual([]);
  });

  it("keeps clarification as a single grounded question", () => {
    const selection = selectAdviceMove({
      plan: plan("clarifying_probe"),
      facts: [fact("Gates{Quiet? Offline? Busy?}")],
    });

    expect(selection.move).toBe("ask_clarifying");
    expect(selection.promptGuidance).toContain("Ask one short");
    expect(selection.disallowedGenericFallbacks).not.toContain(
      "do not ask the user to copy context again",
    );
  });

  it("reroutes blocked clarifying move to a concrete alternative", () => {
    const clarifying = candidate("clarifying_probe", 1.2);
    const concrete = candidate("debug_next_step", 0.9);
    const selection = selectAdviceMove({
      plan: multiPlan(clarifying, [clarifying, concrete]),
      facts: [fact("TypeError: x is undefined")],
      outcomes: [
        outcome("clarifying_probe", "ignored", 1),
        outcome("clarifying_probe", "stale", 2),
      ],
    });

    expect(selection.candidate?.kind).toBe("debug_next_step");
    expect(selection.move).toBe("fix_error");
    expect(selection.reasons).toContain("rerouted by move outcome learning");
  });

  it("marks repeatedly bad break advice as blocked", () => {
    const reputation = summarizeAdviceMoveReputation({
      move: "take_break",
      outcomes: [outcome("rest", "ignored", 1), outcome("rest", "interrupted", 2)],
    });

    expect(reputation.label).toBe("blocked");
    expect(reputation.confidenceAdjustment).toBeLessThan(0);
  });

  it("raises confidence for trusted error-fixing moves", () => {
    const selection = selectAdviceMove({
      plan: plan("terminal_error_triage"),
      facts: [fact("npm ERR! missing dependency")],
      outcomes: [
        outcome("terminal_error_triage", "resolved", 1),
        outcome("terminal_error_triage", "helped", 2),
      ],
    });

    expect(selection.move).toBe("fix_error");
    expect(selection.reputation?.label).toBe("trusted");
    expect(selection.confidence).toBeGreaterThan(0.7);
    expect(selection.promptGuidance).toContain("Move outcome learning");
  });

  it("formats move reputation diagnostics", () => {
    const lines = formatAdviceMoveReputationsForDiagnostics([
      outcome("terminal_error_triage", "resolved", 1),
      outcome("rest", "ignored", 2),
      outcome("rest", "stale", 3),
    ]);

    expect(lines[0]).toContain("take_break blocked");
    expect(lines.join(" ")).toContain("fix_error trusted");
  });
});
