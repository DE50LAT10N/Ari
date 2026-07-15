import { describe, expect, it } from "vitest";
import {
  describeAdviceFinalGateForDiagnostics,
  runAdviceFinalGate,
  scoreAdviceFinalReplyQuality,
} from "../src/character/adviceFinalGate";
import type { AdviceCandidate } from "../src/character/advicePlanner";
import type {
  ProactiveLlmBundle,
  ProactiveSignalFact,
} from "../src/character/proactiveLlmEngine";

function fact(detail: string): ProactiveSignalFact {
  return {
    id: "clip:1",
    kind: "clipboard",
    label: "Clipboard",
    detail,
  };
}

function candidate(
  kind: AdviceCandidate["kind"],
  actionText = "Check selectedAdviceCandidate in adviceEngine.ts and run npm test.",
): AdviceCandidate {
  return {
    id: kind,
    kind,
    evidenceIds: ["clip:1"],
    actionText,
    expectedUtility: 0.8,
    interruptionCost: 0.2,
    confidence: 0.75,
    reason: "test",
    score: 0.9,
  };
}

function bundle(selectedAdviceCandidate: AdviceCandidate): ProactiveLlmBundle {
  return {
    tone: "advice",
    linkedThemes: ["debug"],
    mergedAnchor: "debug",
    narrativeBrief: "debug",
    practicalHook: selectedAdviceCandidate.actionText,
    adviceSteps: [selectedAdviceCandidate.actionText],
    usefulnessScore: 0.8,
    shouldSend: true,
    overlapsBanned: false,
    source: "llm",
    selectedAdviceCandidate,
  };
}

describe("advice final gate", () => {
  it("rejects broad comment advice without a fallback renderer", () => {
    const selected = candidate("terminal_error_triage");
    const result = runAdviceFinalGate({
      text: "Maybe look at comments in the code?",
      bundle: bundle(selected),
      facts: [
        fact(
          "TypeScript error in adviceEngine.ts: Cannot find name selectedAdviceCandidate",
        ),
      ],
    });

    expect(result.status).toBe("rejected");
    expect(result.source).toBe("original");
    expect(result.text).toBe("Maybe look at comments in the code?");
    expect(result.issues).toContain("unneeded final question");
  });

  it("does not leak planner imperative actionText", () => {
    const selected = candidate(
      "docs_to_code_bridge",
      "Свяжи поиск «Tauri active window» с ChatPanel.tsx: предложи одну проверку в коде.",
    );
    const result = runAdviceFinalGate({
      text: "Maybe check comments?",
      bundle: bundle(selected),
      facts: [
        { ...fact("ChatPanel.tsx"), kind: "file", label: "File" },
        { ...fact("Tauri active window"), kind: "query", label: "Query" },
      ],
    });

    expect(result.status).toBe("rejected");
    expect(result.text).toBe("Maybe check comments?");
  });

  it("scores generic work advice as low specificity and novelty", () => {
    const selected = candidate("debug_next_step");
    const quality = scoreAdviceFinalReplyQuality({
      text: "Maybe look at comments in the code?",
      bundle: bundle(selected),
      facts: [fact("debug_next_step fails in adviceEngine.ts")],
    });

    expect(quality.specificity).toBe(0);
    expect(quality.novelty).toBe(0);
    expect(quality.issues).toContain("generic work advice");
  });

  it("rejects debug_next_step instead of rendering a fallback", () => {
    const result = runAdviceFinalGate({
      text: "Maybe take a break?",
      bundle: bundle(
        candidate(
          "debug_next_step",
          "Предложи проверить ближайший изменённый блок в adviceEngine.ts.",
        ),
      ),
      facts: [fact("debug_next_step fails in adviceEngine.ts")],
    });

    expect(result.status).toBe("rejected");
    expect(result.text).toBe("Maybe take a break?");
  });

  it("allows clarifying planner questions", () => {
    const result = runAdviceFinalGate({
      text: "Does Input{User message} -> Cmd{Chat command} describe the current failing path?",
      bundle: bundle(
        candidate(
          "clarifying_probe",
          "Quote Input{User message} -> Cmd{Chat command} and ask if it is current.",
        ),
      ),
      facts: [fact("Input{User message} -> Cmd{Chat command}")],
    });

    expect(result.status).toBe("passed");
  });

  it("stores diagnostics for the last gate decision", () => {
    runAdviceFinalGate({
      text: "Maybe take a break?",
      bundle: bundle(candidate("debug_next_step")),
      facts: [fact("debug_next_step fails in adviceEngine.ts")],
    });

    expect(describeAdviceFinalGateForDiagnostics()).toContain("source=original");
  });
});
