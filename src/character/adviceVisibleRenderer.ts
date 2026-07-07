import type { AdviceCandidate, AdviceCandidateGuidance } from "./advicePlanner";
import { VISIBLE_REPLY_QUALITY_CONFIG } from "./adviceSignalConfig";
import type { ProactiveLlmBundle, ProactiveSignalFact } from "./proactiveLlmEngine";

const ERROR_PATTERN =
  /error|exception|traceback|failed|failure|panic|assert|cannot|undefined|null|ошиб|упал|падает|stack/iu;
const CODE_TOKEN_PATTERN =
  /[A-Za-z_$][\w$]{2,}|[A-Z][A-Za-z0-9]*(?:\{|\(|\.|:)|[a-z]+(?:_[a-z0-9]+)+/g;
const WEAK_ANCHORS = new Set([
  "file",
  "clipboard",
  "query",
  "reference",
  "screen",
  "task",
  "goal",
]);

function compact(value?: string, max = 120): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.!?-]+/u, "")
    .trim()
    .slice(0, max)
    .trim();
}

function factByKind(
  facts: ProactiveSignalFact[],
  kind: ProactiveSignalFact["kind"],
): ProactiveSignalFact | undefined {
  const matches = facts.filter((fact) => fact.kind === kind);
  return matches[matches.length - 1];
}

function errorFact(facts: ProactiveSignalFact[]): ProactiveSignalFact | undefined {
  return facts.find((fact) => ERROR_PATTERN.test(fact.detail));
}

function quoteFact(fact?: ProactiveSignalFact, max = 90): string {
  const value = compact(fact?.detail, max);
  return value ? `«${value}»` : "";
}

function firstCodeToken(facts: ProactiveSignalFact[]): string {
  const text = facts.map((fact) => `${fact.label} ${fact.detail}`).join(" ");
  for (const match of text.matchAll(CODE_TOKEN_PATTERN)) {
    const token = match[0].replace(/[({.:]+$/g, "");
    if (
      token.length >= 3 &&
      !WEAK_ANCHORS.has(token.toLowerCase()) &&
      !/^(const|let|var|return|type|from|import|export)$/i.test(token)
    ) {
      return token;
    }
  }
  return "";
}

function firstFileLikeToken(facts: ProactiveSignalFact[]): string {
  const text = facts.map((fact) => fact.detail).join(" ");
  return (
    text.match(/\b[\w.-]+\.(?:tsx?|jsx?|rs|py|md|json|toml|ya?ml)\b/i)?.[0] ??
    ""
  );
}

function ensureSentence(text: string): string {
  const normalized = compact(text, VISIBLE_REPLY_QUALITY_CONFIG.maxVisibleAdviceChars);
  if (!normalized) {
    return "";
  }
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
}

function workAnchor(
  facts: ProactiveSignalFact[],
  bundle: ProactiveLlmBundle,
  guidance?: AdviceCandidateGuidance,
): string {
  const file = factByKind(facts, "file");
  const clip = factByKind(facts, "clipboard");
  const query = factByKind(facts, "query");
  const reference = factByKind(facts, "reference");
  const fileLike = firstFileLikeToken(facts);
  const token = firstCodeToken(facts);
  const guidanceAnchor = compact(guidance?.visibleAnchor, 90);
  return (
    fileLike ||
    compact(file?.detail, 90) ||
    compact(clip?.detail, 90) ||
    compact(query?.detail, 90) ||
    compact(reference?.detail, 90) ||
    (guidanceAnchor && !WEAK_ANCHORS.has(guidanceAnchor.toLowerCase())
      ? guidanceAnchor
      : "") ||
    token ||
    compact(bundle.mergedAnchor || bundle.narrativeBrief, 90) ||
    "текущем месте"
  );
}

function fallbackGuidance(
  candidate: AdviceCandidate,
  facts: ProactiveSignalFact[],
): AdviceCandidateGuidance {
  const actionAnchor =
    candidate.actionText.match(/\b[\w.-]+\.(?:tsx?|jsx?|rs|py|md|json|toml|ya?ml)\b/i)?.[0] ??
    "";
  const anchor = firstFileLikeToken(facts) || actionAnchor || firstCodeToken(facts);
  switch (candidate.kind) {
    case "clarifying_probe":
    case "uncertainty_probe":
      return {
        intent: "clarify",
        visibleAnchor: anchor,
        suggestedCheck: "уточнить, относится ли сигнал к текущей задаче",
        expectedResult: "следующий совет попадёт в нужную точку",
      };
    case "rest":
      return {
        intent: "rest",
        visibleAnchor: anchor,
        suggestedCheck: "коротко отойти и вернуться к одному шагу",
        expectedResult: "внимание вернётся без нового шума",
      };
    case "scope_cut":
    case "refocus":
      return {
        intent: "focus",
        visibleAnchor: anchor,
        suggestedCheck: "выбрать одну нить и проверить один результат",
        expectedResult: "контекст перестанет расползаться",
      };
    case "docs_lookup":
    case "docs_to_code_bridge":
    case "solution_lookup":
      return {
        intent: "verify",
        visibleAnchor: anchor,
        suggestedCheck: "проверить одну гипотезу из доков прямо в коде",
        expectedResult: "останется только fix, который меняет симптом",
      };
    default:
      return {
        intent: "fix",
        visibleAnchor: anchor,
        suggestedCheck: "проверить один изменённый блок, один вход и один видимый выход",
        expectedResult: "симптом изменится или станет уже",
      };
  }
}

export function renderAdviceCandidateReply(input: {
  candidate: AdviceCandidate;
  bundle: ProactiveLlmBundle;
  facts: ProactiveSignalFact[];
}): string | null {
  const { candidate, bundle, facts } = input;
  const guidance = candidate.guidance ?? fallbackGuidance(candidate, facts);
  const file = factByKind(facts, "file");
  const clip = factByKind(facts, "clipboard");
  const query = factByKind(facts, "query");
  const reference = factByKind(facts, "reference");
  const task = factByKind(facts, "task") ?? factByKind(facts, "goal");
  const err = errorFact(facts);
  const anchor = workAnchor(facts, bundle, guidance);
  const token = firstCodeToken(facts);
  const codeAnchor = firstFileLikeToken(facts) || guidance.visibleAnchor || token;
  const check = compact(guidance.suggestedCheck, 150);
  const expected = compact(guidance.expectedResult, 140);
  const errorQuote = quoteFact(err ?? clip, 110);

  switch (candidate.kind) {
    case "terminal_error_triage":
    case "test_failure_triage":
      return ensureSentence(
        errorQuote
          ? `Я бы начала с ${errorQuote}: ${check} рядом с ${anchor}. Критерий простой: ${expected}`
          : `Я бы сузила это до ${anchor}: ${check}. Критерий простой: ${expected}`,
      );
    case "debug_next_step":
    case "stale_context_warning":
    case "refocus":
      return ensureSentence(
        codeAnchor
          ? `Зацепка тут в ${codeAnchor}: ${check}, без общего обзора файла. Дальше смотри, ${expected}`
          : `Зацепка тут в ${anchor}: ${check}. Дальше смотри, ${expected}`,
      );
    case "docs_lookup":
    case "docs_to_code_bridge":
    case "solution_lookup":
      return ensureSentence(
        query || reference
          ? `Связка ${quoteFact(query ?? reference, 80)} -> ${anchor}: ${check}. Оставь только то, после чего ${expected}`
          : `Я бы не уходила в общий поиск: ${check} в ${anchor}. Оставь только то, после чего ${expected}`,
      );
    case "task_bridge":
      return ensureSentence(
        task
          ? `Это похоже на хвост задачи ${quoteFact(task, 80)}: ${check} в ${anchor}, потом проверь, что ${expected}`
          : `Сведи это к одному шагу в ${anchor}: ${check}, потом проверь, что ${expected}`,
      );
    case "scope_cut":
      return ensureSentence(
        `Слишком много нитей сразу. В ${anchor} сделай так: ${check}; следующий хвост поднимай только когда ${expected}`,
      );
    case "memory_pattern":
      return ensureSentence(
        `Тут просится старый рабочий паттерн: ${check} в ${anchor}. Хороший знак, если ${expected}`,
      );
    case "rest":
      return ensureSentence(
        `Похоже, пауза сейчас полезнее ещё одного рывка: ${check}. Возвращайся, когда ${expected}`,
      );
    case "clarifying_probe":
    case "uncertainty_probe":
      if (clip) {
        return `В буфере ${quoteFact(clip, 90)}. Это текущая отладка или случайный фрагмент?`;
      }
      if (file) {
        return `В ${compact(file.detail, 90)} сейчас упор в ошибку, структуру кода или выбор следующего шага?`;
      }
      return `Я вижу сигнал по ${anchor}. Это текущая точка, где ты застрял?`;
    default:
      return null;
  }
}
