import { candidateKindToAdviceMove, type AdviceMoveKind } from "./adviceMoveSelector";
import { renderAdviceCandidateReply } from "./adviceVisibleRenderer";
import {
  PASSING_ADVICE_QUALITY,
  VISIBLE_REPLY_QUALITY_CONFIG,
  type AdviceQualityScore,
} from "./adviceSignalConfig";
import type {
  ProactiveInitiativeMove,
  ProactiveLlmBundle,
  ProactiveSignalFact,
} from "./proactiveLlmEngine";

export type AdviceFinalGateStatus = "passed" | "repaired" | "rejected";

export type AdviceFinalGateResult = {
  status: AdviceFinalGateStatus;
  text: string;
  issues: string[];
  reason: string;
  source?: "original" | "renderer";
  candidateKind?: string;
};

const STORAGE_KEY = "desktop-character.advice-final-gate.v1";
const BROAD_COMMENTARY_PATTERN =
  /(?:comment|comments|break|rest|walk|коммент|комментар|архитектур|структур|общ(?:ий|ую)|в целом|свежим взглядом|сделай перерыв|отдохн|глазам|мозг)/iu;
const ASK_FOR_CONTEXT_PATTERN =
  /(?:скопир|пришли|вставь|покажи|расскажи,?\s+что|что там у тебя|дай контекст|open clipboard|открою буфер)/iu;
const PLANNER_IMPERATIVE_PATTERN =
  /(?:^|\b)(?:suggest|propose|connect|link|quote|ask|use|give|check|свяжи|предложи|дай|процитируй|спроси|используй|вытащи|опираясь|мягко предложи|коротко уточни)\b/iu;
const QUESTION_END_PATTERN = /[?\uFF1F]\s*$/u;
const CODE_IDENTIFIER_PATTERN =
  /[A-Za-z_$][\w$]{2,}|[A-Z][A-Za-z0-9]*(?:\{|\(|\.|:)|[a-z]+(?:_[a-z0-9]+)+/g;
const ERROR_PATTERN =
  /(?:error|exception|traceback|failed|failure|panic|assert|cannot|undefined|null|ошиб|упал|падает|не\s+работает|stack)/iu;
const CONCRETE_ACTION_PATTERN =
  /(?:проверь|проверить|запусти|запустить|сравни|сравнить|замени|заменить|убери|добавь|переименуй|импорт|экспорт|тип|guard|return|await|async|catch|try|test|npm|cargo|function|const|class|interface|props|state|hook|config|строк|файл|метод)/iu;

let lastGateResult: AdviceFinalGateResult | null = loadLastGateResult();

function loadLastGateResult(): AdviceFinalGateResult | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AdviceFinalGateResult) : null;
  } catch {
    return null;
  }
}

function saveLastGateResult(result: AdviceFinalGateResult): void {
  lastGateResult = result;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ari-proactive-state-changed"));
    }
  } catch {
    // Diagnostics are best-effort only.
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function moveFromInitiative(move?: ProactiveInitiativeMove): AdviceMoveKind {
  switch (move) {
    case "concrete_step":
    case "context_fact":
      return "unstick_next_step";
    case "clipboard_probe":
    case "ide_invite":
    case "followup_probe":
      return "ask_clarifying";
    default:
      return "unstick_next_step";
  }
}

function inferMove(bundle: ProactiveLlmBundle): AdviceMoveKind {
  return (
    candidateKindToAdviceMove(bundle.selectedAdviceCandidate?.kind) ??
    moveFromInitiative(bundle.initiativeMove)
  );
}

function isClarifying(bundle: ProactiveLlmBundle, move: AdviceMoveKind): boolean {
  return (
    move === "ask_clarifying" ||
    bundle.selectedAdviceCandidate?.kind === "clarifying_probe" ||
    bundle.selectedAdviceCandidate?.kind === "uncertainty_probe"
  );
}

function hasWorkFact(facts: ProactiveSignalFact[]): boolean {
  return facts.some((fact) =>
    ["clipboard", "file", "code", "screen", "query", "reference", "hypothesis"].includes(
      fact.kind,
    ),
  );
}

function factText(facts: ProactiveSignalFact[]): string {
  return facts.map((fact) => `${fact.label} ${fact.detail}`).join("\n");
}

function extractIdentifiers(facts: ProactiveSignalFact[]): string[] {
  const seen = new Set<string>();
  for (const match of factText(facts).matchAll(CODE_IDENTIFIER_PATTERN)) {
    const token = match[0].replace(/[({.:]+$/g, "");
    if (
      token.length >= 3 &&
      !/^(const|let|var|return|type|from|import|export)$/i.test(token)
    ) {
      seen.add(token);
    }
    if (seen.size >= VISIBLE_REPLY_QUALITY_CONFIG.maxIdentifiersChecked) {
      break;
    }
  }
  return [...seen];
}

function mentionsFactAnchor(text: string, facts: ProactiveSignalFact[]): boolean {
  const haystack = text.toLowerCase();
  return extractIdentifiers(facts).some((token) =>
    haystack.includes(token.toLowerCase()),
  );
}

export function scoreAdviceFinalReplyQuality(input: {
  text: string;
  bundle: ProactiveLlmBundle;
  facts: ProactiveSignalFact[];
}): AdviceQualityScore {
  const text = normalizeText(input.text);
  const quality: AdviceQualityScore = { ...PASSING_ADVICE_QUALITY, issues: [] };
  const move = inferMove(input.bundle);
  const clarifying = isClarifying(input.bundle, move);
  const factsText = factText(input.facts);
  const workFact = hasWorkFact(input.facts);
  const hasErrorContext = ERROR_PATTERN.test(factsText);

  if (!text) {
    return {
      grounding: 0,
      specificity: 0,
      actionability: 0,
      novelty: 0,
      voiceSafety: 0,
      issues: ["empty final advice"],
    };
  }
  if (PLANNER_IMPERATIVE_PATTERN.test(text)) {
    quality.voiceSafety = 0;
    quality.issues.push("planner instruction leak");
  }
  if (!clarifying && QUESTION_END_PATTERN.test(text)) {
    quality.actionability = 0;
    quality.issues.push("unneeded final question");
  }
  if (workFact && move !== "take_break" && BROAD_COMMENTARY_PATTERN.test(text)) {
    quality.specificity = 0;
    quality.novelty = 0;
    quality.issues.push("generic work advice");
  }
  if (workFact && ASK_FOR_CONTEXT_PATTERN.test(text)) {
    quality.grounding = 0;
    quality.issues.push("asks for already available context");
  }
  if (
    (move === "fix_error" || hasErrorContext) &&
    (!CONCRETE_ACTION_PATTERN.test(text) || !mentionsFactAnchor(text, input.facts))
  ) {
    quality.grounding = 0;
    quality.actionability = 0;
    quality.issues.push("missing concrete error action");
  }
  if (
    (move === "explain_code" || move === "unstick_next_step") &&
    workFact &&
    !CONCRETE_ACTION_PATTERN.test(text) &&
    !mentionsFactAnchor(text, input.facts)
  ) {
    quality.grounding = 0;
    quality.specificity = 0;
    quality.issues.push("missing work anchor");
  }
  if (
    input.bundle.selectedAdviceCandidate &&
    input.bundle.selectedAdviceCandidate.kind !== "rest" &&
    /(?:break|rest|walk|перерыв|отдохн|глазам|прогуля)/iu.test(text)
  ) {
    quality.actionability = 0;
    quality.issues.push("wrong break fallback");
  }

  return {
    ...quality,
    issues: [...new Set(quality.issues)],
  };
}

function validateAdviceFinalReply(input: {
  text: string;
  bundle: ProactiveLlmBundle;
  facts: ProactiveSignalFact[];
}): string[] {
  return scoreAdviceFinalReplyQuality(input).issues;
}

function trimSentence(
  text: string,
  limit = VISIBLE_REPLY_QUALITY_CONFIG.maxVisibleAdviceChars,
): string {
  const normalized = normalizeText(text);
  if (normalized.length <= limit) {
    return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
  }
  const cut = normalized.slice(0, limit).replace(/\s+\S*$/u, "").trim();
  return /[.!?]$/u.test(cut) ? cut : `${cut}.`;
}

function buildFallbackText(
  bundle: ProactiveLlmBundle,
  facts: ProactiveSignalFact[],
): { text: string; source: AdviceFinalGateResult["source"]; candidateKind?: string } | null {
  const candidate = bundle.selectedAdviceCandidate;
  if (!candidate) {
    return null;
  }
  const rendered = renderAdviceCandidateReply({ candidate, bundle, facts });
  if (!rendered) {
    return null;
  }
  return {
    text: trimSentence(rendered),
    source: "renderer",
    candidateKind: candidate.kind,
  };
}

export function runAdviceFinalGate(input: {
  text: string;
  bundle: ProactiveLlmBundle;
  facts: ProactiveSignalFact[];
}): AdviceFinalGateResult {
  const originalIssues = validateAdviceFinalReply(input);
  if (originalIssues.length === 0) {
    const result: AdviceFinalGateResult = {
      status: "passed",
      text: input.text,
      issues: [],
      reason: "final advice accepted",
      source: "original",
      candidateKind: input.bundle.selectedAdviceCandidate?.kind,
    };
    saveLastGateResult(result);
    return result;
  }

  const fallback = buildFallbackText(input.bundle, input.facts);
  if (!fallback) {
    const result: AdviceFinalGateResult = {
      status: "rejected",
      text: input.text,
      issues: originalIssues,
      reason: `rejected: ${originalIssues.join(", ")}`,
      source: "original",
      candidateKind: input.bundle.selectedAdviceCandidate?.kind,
    };
    saveLastGateResult(result);
    return result;
  }

  const fallbackIssues = validateAdviceFinalReply({
    ...input,
    text: fallback.text,
  });
  const result: AdviceFinalGateResult =
    fallbackIssues.length === 0
      ? {
          status: "repaired",
          text: fallback.text,
          issues: originalIssues,
          reason: `repaired: source=${fallback.source}; candidate=${fallback.candidateKind ?? "none"}; issues=${originalIssues.join(", ")}`,
          source: fallback.source,
          candidateKind: fallback.candidateKind,
        }
      : {
          status: "rejected",
          text: input.text,
          issues: originalIssues,
          reason: `rejected: ${originalIssues.join(", ")}; renderer issues=${fallbackIssues.join(", ")}`,
          source: fallback.source,
          candidateKind: fallback.candidateKind,
        };
  saveLastGateResult(result);
  return result;
}

export function describeAdviceFinalGateForDiagnostics(): string | null {
  const result = lastGateResult ?? loadLastGateResult();
  if (!result) {
    return null;
  }
  const sourceText = result.source ? ` source=${result.source}` : "";
  const candidateText = result.candidateKind ? ` candidate=${result.candidateKind}` : "";
  const issueText = result.issues.length ? ` - ${result.issues.join(", ")}` : "";
  return `${result.status}:${sourceText}${candidateText}: ${result.reason}${issueText}`;
}
