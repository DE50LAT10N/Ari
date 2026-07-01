import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";
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
  | "stale_context"
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
  return Math.max(0, Math.min(0.95, value));
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
