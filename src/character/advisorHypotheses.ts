import { clamp } from "../platform/mathUtils";
import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";
import {
  describeClipboardSemantics,
  isClipboardSemanticallyRich,
} from "../platform/clipboardSemantics";
import {
  deriveScreenState,
  describeScreenState,
  screenStateHasTestFailure,
  type ScreenState,
} from "./screenState";

export type AdvisorHypothesisKind =
  | "terminal_error"
  | "test_failure"
  | "docs_to_code"
  | "clipboard_solution"
  | "stale_context"
  | "stuck_before_search"
  | "scope_creep"
  | "refocus"
  | "rest"
  | "uncertain";

export type AdvisorHypothesis = {
  id: string;
  kind: AdvisorHypothesisKind;
  claim: string;
  evidenceFactIds: string[];
  confidence: number;
  risk: "low" | "medium" | "high";
  suggestedMove: "ask" | "advise" | "wait" | "celebrate";
  screenState: ScreenState;
};

function factIds(
  facts: ProactiveSignalFact[],
  predicate: (fact: ProactiveSignalFact) => boolean,
): string[] {
  return facts.filter(predicate).map((fact) => fact.id);
}

function clampConfidence(value: number): number {
  return clamp(value, 0, 0.95);
}

function queryLooksRelatedToFile(query: string, file?: string): boolean {
  if (!file) {
    return false;
  }
  const haystack = file.toLowerCase();
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length >= 4)
    .some((word) => haystack.includes(word));
}

export function buildAdvisorHypotheses(
  bundle: InitiativeSignalBundle,
  facts: ProactiveSignalFact[],
): AdvisorHypothesis[] {
  const screenState = deriveScreenState(bundle);
  const hypotheses: AdvisorHypothesis[] = [];
  const push = (hypothesis: Omit<AdvisorHypothesis, "screenState">) => {
    hypotheses.push({
      ...hypothesis,
      confidence: clampConfidence(hypothesis.confidence),
      screenState,
    });
  };

  const screenFactIds = factIds(
    facts,
    (fact) =>
      fact.kind === "screen" ||
      fact.kind === "clipboard" ||
      fact.kind === "file" ||
      fact.kind === "urgency",
  );
  const queryFacts = facts.filter((fact) => fact.kind === "query");
  const fileFacts = factIds(facts, (fact) => fact.kind === "file");
  const clipboardFacts = facts.filter((fact) => fact.kind === "clipboard");

  if (screenState.visibleProblem) {
    const isTestFailure = screenStateHasTestFailure(screenState);
    push({
      id: isTestFailure ? "screen-test-failure" : "screen-terminal-error",
      kind: isTestFailure ? "test_failure" : "terminal_error",
      claim: isTestFailure
        ? `Похоже, на экране падение теста: ${screenState.visibleProblem.slice(0, 120)}`
        : `Похоже, пользователь разбирает ошибку: ${screenState.visibleProblem.slice(0, 120)}`,
      evidenceFactIds: screenFactIds,
      confidence: screenState.confidence + (isTestFailure ? 0.08 : 0.04),
      risk: "low",
      suggestedMove: "advise",
    });
  }

  const relatedQuery = queryFacts.find((fact) =>
    queryLooksRelatedToFile(fact.detail, bundle.editorFile),
  );
  const anyQuery = queryFacts[0];
  if (bundle.editorFile && (relatedQuery || anyQuery)) {
    push({
      id: "docs-to-code",
      kind: "docs_to_code",
      claim: `Поиск ${relatedQuery?.detail ?? anyQuery?.detail} можно связать с файлом ${bundle.editorFile}`,
      evidenceFactIds: [
        ...(relatedQuery ? [relatedQuery.id] : anyQuery ? [anyQuery.id] : []),
        ...fileFacts,
      ],
      confidence: relatedQuery ? 0.78 : 0.62,
      risk: relatedQuery ? "low" : "medium",
      suggestedMove: relatedQuery ? "advise" : "ask",
    });
  }

  const clipboardFactScore = (fact: ProactiveSignalFact): number => {
    if (
      /error|exception|failed|cannot|denied|not found|ошиб|traceback|panic/i.test(
        fact.detail,
      )
    ) {
      return 5;
    }
    if (isClipboardSemanticallyRich(fact.detail)) {
      return 4;
    }
    if (/function|const|class|import|def |https?:\/\/|www\./i.test(fact.detail)) {
      return 3;
    }
    return fact.detail.length >= 24 ? 1 : 0;
  };
  const latestClip = [...clipboardFacts]
    .reverse()
    .sort((left, right) => clipboardFactScore(right) - clipboardFactScore(left))[0];
  if (latestClip && clipboardFactScore(latestClip) > 0) {
    const diagnostic =
      /error|exception|failed|cannot|denied|not found|ошиб|traceback|panic/i.test(
        latestClip.detail,
      );
    const semantics = describeClipboardSemantics(latestClip.detail);
    const semanticClaim = semantics ? ` Элементы: ${semantics}` : "";
    push({
      id: "clipboard-solution",
      kind: diagnostic ? "terminal_error" : "clipboard_solution",
      claim: diagnostic
        ? `В буфере диагностический фрагмент, его можно разобрать без уточнения: ${latestClip.detail.slice(0, 140)}`
        : `В буфере содержательный фрагмент, по нему можно дать следующий шаг: ${latestClip.detail.slice(0, 140)}.${semanticClaim}`,
      evidenceFactIds: [latestClip.id, ...fileFacts],
      confidence: diagnostic ? 0.86 : semantics ? 0.82 : 0.68,
      risk: "low",
      suggestedMove: "advise",
    });
  }

  if (bundle.taskActivityLink?.shouldAsk) {
    push({
      id: "stale-context",
      kind: "stale_context",
      claim: `Связь активности с задачей неочевидна: ${bundle.taskActivityLink.reason}`,
      evidenceFactIds: factIds(facts, (fact) => fact.kind === "task" || fact.kind === "file"),
      confidence: bundle.taskActivityLink.confidence === "weak" ? 0.58 : 0.7,
      risk: "medium",
      suggestedMove: "ask",
    });
  }

  if (
    bundle.editorFile &&
    bundle.advisor.activitySummary.inputFrictionScore >= 1
  ) {
    const friction = bundle.advisor.activitySummary;
    push({
      id: "stuck-before-search",
      kind: "stuck_before_search",
      claim: `Похоже, пользователь застревает в ${bundle.editorFile} до поиска: input friction ${friction.inputFrictionScore.toFixed(1)}, паузы ${friction.recentInputPauses}, возвраты ${friction.recentInputReturns}, исправления ${friction.recentCorrectionChurns}, bursts ${friction.recentKeyboardBursts}`,
      evidenceFactIds: [
        ...fileFacts,
        ...factIds(facts, (fact) => fact.kind === "session" || fact.kind === "urgency"),
      ],
      confidence: 0.62 + Math.min(0.22, friction.inputFrictionScore * 0.06),
      risk: "medium",
      suggestedMove: "advise",
    });
  }

  if (bundle.advisor.scopeCreep || bundle.advisor.openTaskCount >= 6) {
    push({
      id: "scope-creep",
      kind: "scope_creep",
      claim: `Открыто много хвостов: ${bundle.advisor.openTaskCount}`,
      evidenceFactIds: factIds(facts, (fact) => fact.kind === "task" || fact.kind === "wm"),
      confidence: 0.68,
      risk: "medium",
      suggestedMove: "advise",
    });
  }

  if (bundle.advisor.contextThrash) {
    push({
      id: "refocus",
      kind: "refocus",
      claim: "Видны частые переключения контекста",
      evidenceFactIds: factIds(facts, (fact) => fact.kind === "wm" || fact.kind === "session"),
      confidence: 0.66,
      risk: "medium",
      suggestedMove: "advise",
    });
  }

  if (bundle.advisor.breakDue) {
    push({
      id: "rest",
      kind: "rest",
      claim: "Сессия достаточно длинная для короткой паузы",
      evidenceFactIds: factIds(facts, (fact) => fact.kind === "session" || fact.kind === "urgency"),
      confidence: 0.64,
      risk: "low",
      suggestedMove: "advise",
    });
  }

  if (!hypotheses.length && screenState.confidence >= 0.45) {
    push({
      id: "uncertain-screen-context",
      kind: "uncertain",
      claim: `Контекст виден, но следующий шаг неочевиден: ${describeScreenState(screenState)}`,
      evidenceFactIds: factIds(facts, (fact) => fact.kind === "screen" || fact.kind === "file"),
      confidence: Math.min(0.58, screenState.confidence),
      risk: "medium",
      suggestedMove: "ask",
    });
  }

  return hypotheses.sort((left, right) => right.confidence - left.confidence);
}

export function topAdvisorHypothesis(
  bundle: InitiativeSignalBundle,
  facts: ProactiveSignalFact[],
): AdvisorHypothesis | undefined {
  return buildAdvisorHypotheses(bundle, facts)[0];
}

export function describeAdvisorHypotheses(
  hypotheses: AdvisorHypothesis[],
): string {
  return hypotheses
    .slice(0, 3)
    .map(
      (hypothesis) =>
        `${hypothesis.kind} ${hypothesis.confidence.toFixed(2)}: ${hypothesis.claim}`,
    )
    .join(" | ");
}
