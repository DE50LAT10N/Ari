import { describe, expect, it } from "vitest";
import { runAdviceFinalGate } from "../src/character/adviceFinalGate";
import type { AdviceCandidate, AdviceCandidateGuidance } from "../src/character/advicePlanner";
import type { ProactiveLlmBundle, ProactiveSignalFact } from "../src/character/proactiveLlmEngine";

function fact(
  kind: ProactiveSignalFact["kind"],
  detail: string,
  id = `${kind}:1`,
): ProactiveSignalFact {
  return {
    id,
    kind,
    label: kind,
    detail,
  };
}

function candidate(
  kind: AdviceCandidate["kind"],
  guidance: AdviceCandidateGuidance,
  actionText = "Свяжи факты и предложи одно действие.",
): AdviceCandidate {
  return {
    id: kind,
    kind,
    evidenceIds: ["file:1", "clip:1"],
    actionText,
    guidance,
    expectedUtility: 0.8,
    interruptionCost: 0.2,
    confidence: 0.75,
    reason: "fixture",
    score: 0.9,
  };
}

function bundle(selectedAdviceCandidate: AdviceCandidate): ProactiveLlmBundle {
  return {
    tone: "advice",
    linkedThemes: ["fixture"],
    mergedAnchor: selectedAdviceCandidate.guidance?.visibleAnchor ?? "fixture",
    narrativeBrief: "fixture",
    practicalHook: selectedAdviceCandidate.actionText,
    adviceSteps: [selectedAdviceCandidate.actionText],
    usefulnessScore: 0.8,
    shouldSend: true,
    overlapsBanned: false,
    source: "llm",
    selectedAdviceCandidate,
  };
}

describe("advice pipeline fixtures", () => {
  it("turns an IDE stacktrace into a concrete rendered repair", () => {
    const selected = candidate("terminal_error_triage", {
      intent: "fix",
      visibleAnchor: "ChatPanel.tsx",
      suggestedCheck: "проверь первый stack frame и ближайший import",
      expectedResult: "ошибка сдвинется или исчезнет",
    });
    const result = runAdviceFinalGate({
      text: "Maybe inspect comments?",
      bundle: bundle(selected),
      facts: [
        fact("file", "ChatPanel.tsx", "file:1"),
        fact("clipboard", "ReferenceError: selectedAdviceCandidate is not defined", "clip:1"),
      ],
    });

    expect(result.status).toBe("repaired");
    expect(result.text).toContain("ChatPanel");
    expect(result.text).toContain("stack frame");
    expect(result.text).not.toContain(selected.actionText);
  });

  it("keeps docs lookup grounded in the file and query", () => {
    const selected = candidate("docs_to_code_bridge", {
      intent: "verify",
      visibleAnchor: "activeWindow.ts",
      suggestedCheck: "проверь один пример разрешений Tauri в текущем коде",
      expectedResult: "станет видно, применим ли fix",
    });
    const result = runAdviceFinalGate({
      text: "Try searching the internet?",
      bundle: bundle(selected),
      facts: [
        fact("file", "activeWindow.ts", "file:1"),
        fact("query", "Tauri active window permissions", "query:1"),
      ],
    });

    expect(result.status).toBe("repaired");
    expect(result.text).toContain("activeWindow");
    expect(result.text).toContain("Tauri");
  });

  it("keeps rest advice only for a rest candidate", () => {
    const selected = candidate("rest", {
      intent: "rest",
      suggestedCheck: "отойти на пять минут",
      expectedResult: "внимание вернётся без нового шума",
    });
    const result = runAdviceFinalGate({
      text: "Maybe look at comments?",
      bundle: bundle(selected),
      facts: [fact("session", "long focus session", "session:1")],
    });

    expect(result.status).toBe("repaired");
    expect(result.text).toMatch(/пауза|отойти/i);
  });

  it("allows one clarifying question for ambiguous clipboard context", () => {
    const selected = candidate("clarifying_probe", {
      intent: "clarify",
      visibleAnchor: "Input{User message} -> Cmd{Chat command}",
      suggestedCheck: "уточнить, текущая ли это отладка",
      expectedResult: "совет попадёт в нужную точку",
    });
    const result = runAdviceFinalGate({
      text: "Maybe check comments?",
      bundle: bundle(selected),
      facts: [fact("clipboard", "Input{User message} -> Cmd{Chat command}", "clip:1")],
    });

    expect(result.status).toBe("repaired");
    expect(result.text.endsWith("?")).toBe(true);
  });
});
