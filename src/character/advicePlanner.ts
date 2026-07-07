import type { AdviceLedgerEntry } from "./adviceLedger";
import {
  adviceTokenOverlap,
  classifyAdviceArchetype,
  evaluateAdviceCandidateNovelty,
} from "./adviceNovelty";
import type { AdviceOutcomeRecord } from "./adviceOutcome";
import type { AdviceUrgency } from "./adviceUrgency";
import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";
import { buildAdvisorHypotheses } from "./advisorHypotheses";
import {
  describeClipboardSemantics,
  isClipboardSemanticallyRich,
} from "../platform/clipboardSemantics";
import { rerankAdviceCandidates } from "./relevanceRanker";

export type AdviceCandidateKind =
  | "debug_next_step"
  | "terminal_error_triage"
  | "test_failure_triage"
  | "docs_to_code_bridge"
  | "stale_context_warning"
  | "uncertainty_probe"
  | "clarifying_probe"
  | "task_bridge"
  | "scope_cut"
  | "refocus"
  | "rest"
  | "docs_lookup"
  | "solution_lookup"
  | "memory_pattern";

export type AdviceCandidate = {
  id: string;
  kind: AdviceCandidateKind;
  evidenceIds: string[];
  actionText: string;
  guidance?: AdviceCandidateGuidance;
  expectedUtility: number;
  interruptionCost: number;
  confidence: number;
  reason: string;
  score: number;
};

export type AdviceCandidateGuidance = {
  intent: "fix" | "explain" | "verify" | "clarify" | "focus" | "rest";
  visibleAnchor?: string;
  suggestedCheck?: string;
  expectedResult?: string;
};

export type AdvicePlan = {
  selected: AdviceCandidate | null;
  candidates: AdviceCandidate[];
  reason: string;
};

function factByKind(
  facts: ProactiveSignalFact[],
  kind: ProactiveSignalFact["kind"],
): ProactiveSignalFact | undefined {
  const matches = facts.filter((fact) => fact.kind === kind);
  return matches[matches.length - 1];
}

function factsByKind(
  facts: ProactiveSignalFact[],
  kind: ProactiveSignalFact["kind"],
): ProactiveSignalFact[] {
  return facts.filter((fact) => fact.kind === kind);
}

function feedbackBonus(
  candidate: Omit<AdviceCandidate, "score">,
  feedback: AdviceLedgerEntry[],
  outcomes: AdviceOutcomeRecord[],
): number {
  let bonus = 0;
  for (const entry of feedback) {
    if (!entry.feedback) continue;
    if (entry.feedback === "useful") {
      bonus += entry.initiativeMove === candidate.kind ? 0.25 : 0.12;
      if (
        entry.practicalHook &&
        candidate.actionText
          .toLowerCase()
          .includes(entry.practicalHook.slice(0, 24).toLowerCase())
      ) {
        bonus += 0.15;
      }
    }
    if (entry.feedback === "too_generic") {
      bonus += candidate.evidenceIds.length >= 2 ? 0.2 : -0.35;
      bonus += /:\d+|\.tsx?|\.ts|\.rs|\.py|npm|pnpm|cargo|лог|import|stack|error/i.test(
        candidate.actionText,
      )
        ? 0.15
        : -0.2;
    }
    if (entry.feedback === "miss") {
      bonus -= 0.45;
      if (candidate.kind === "clarifying_probe") bonus += 0.25;
    }
    if (entry.feedback === "not_now") {
      bonus -= candidate.kind === "rest" ? 0.2 : 0.65;
    }
  }
  const candidateArchetype = classifyAdviceArchetype(
    candidate.actionText,
    candidate.kind,
  );
  for (const entry of outcomes) {
    if (!entry.outcome) continue;
    const sameKind =
      entry.candidateKind === candidate.kind ||
      entry.candidateKind === candidate.id;
    const sameArchetype =
      candidateArchetype !== "unknown" &&
      candidateArchetype ===
        classifyAdviceArchetype(entry.reason, entry.candidateKind);
    if (entry.outcome === "helped" || entry.outcome === "resolved") {
      bonus += sameKind || sameArchetype ? 0.28 : 0.08;
    }
    if (entry.outcome === "ignored") {
      bonus -= sameKind || sameArchetype ? 0.35 : 0.1;
      if (candidate.kind === "clarifying_probe") bonus += 0.12;
    }
    if (entry.outcome === "stale") {
      bonus -= sameKind || sameArchetype ? 0.32 : 0.08;
      bonus += candidate.evidenceIds.length >= 2 ? 0.1 : -0.1;
    }
    if (entry.outcome === "interrupted") {
      bonus -= sameKind || sameArchetype ? 2.25 : 0.18;
      if (candidate.interruptionCost <= 0.28) bonus += 0.08;
    }
  }
  return bonus;
}

function scoreCandidate(
  candidate: Omit<AdviceCandidate, "score">,
  feedback: AdviceLedgerEntry[],
  outcomes: AdviceOutcomeRecord[],
): AdviceCandidate {
  let score =
    candidate.expectedUtility * 1.4 +
    candidate.confidence +
    feedbackBonus(candidate, feedback, outcomes) -
    recentAdviceRepeatPenalty(candidate, feedback) -
    candidate.interruptionCost;
  if (candidate.evidenceIds.some((id) => id.startsWith("clip:"))) {
    score += 0.2;
  }
  return {
    ...candidate,
    guidance: candidate.guidance ?? buildAdviceCandidateGuidance(candidate),
    score,
  };
}

function buildAdviceCandidateGuidance(
  candidate: Omit<AdviceCandidate, "score">,
): AdviceCandidateGuidance {
  const text = candidate.actionText.replace(/\s+/g, " ").trim();
  const anchor =
    text.match(/\b[\w.-]+\.(?:tsx?|jsx?|rs|py|md|json|toml|yml|yaml)\b/i)?.[0] ??
    text.match(/\b[A-Za-z_$][\w$]{2,}\b/)?.[0];
  const intent: AdviceCandidateGuidance["intent"] =
    candidate.kind === "clarifying_probe" || candidate.kind === "uncertainty_probe"
      ? "clarify"
      : candidate.kind === "rest"
        ? "rest"
        : candidate.kind === "scope_cut" || candidate.kind === "refocus"
          ? "focus"
          : candidate.kind === "docs_lookup" ||
              candidate.kind === "docs_to_code_bridge" ||
              candidate.kind === "solution_lookup"
            ? "verify"
            : candidate.kind === "memory_pattern"
              ? "explain"
              : "fix";
  const suggestedCheck =
    intent === "clarify"
      ? "уточнить, относится ли сигнал к текущей задаче"
      : intent === "rest"
        ? "коротко отойти и вернуться к одной проверке"
        : intent === "focus"
          ? "выбрать одну нить и проверить один результат"
          : /expected|received|test/i.test(text)
            ? "сравнить expected/received и перезапустить тот же тест"
            : "проверить один изменённый блок, один вход и один видимый выход";
  const expectedResult =
    intent === "clarify"
      ? "следующий совет попадёт в нужную точку"
      : intent === "rest"
        ? "внимание вернётся без нового шума"
        : "симптом изменится или станет уже";
  return {
    intent,
    visibleAnchor: anchor,
    suggestedCheck,
    expectedResult,
  };
}

function makeCandidate(
  input: Omit<AdviceCandidate, "score">,
  feedback: AdviceLedgerEntry[],
  outcomes: AdviceOutcomeRecord[],
): AdviceCandidate {
  return scoreCandidate(input, feedback, outcomes);
}

function firstUsefulFeedback(
  feedback: AdviceLedgerEntry[],
): AdviceLedgerEntry | undefined {
  return feedback.find(
    (entry) =>
      entry.feedback === "useful" &&
      (entry.practicalHook || entry.replyText || entry.signalSummary),
  );
}

function hasRecentAdviceKind(
  history: AdviceLedgerEntry[],
  kind: string,
  now = Date.now(),
  windowMs = 2 * 60 * 60_000,
): boolean {
  return history.some(
    (entry) =>
      now - entry.at <= windowMs &&
      (entry.adviceCandidateKind === kind || entry.initiativeMove === kind),
  );
}

function recentAdviceRepeatPenalty(
  candidate: Omit<AdviceCandidate, "score">,
  history: AdviceLedgerEntry[],
  now = Date.now(),
): number {
  let penalty = 0;
  let similarCount = 0;
  const candidateArchetype = classifyAdviceArchetype(
    candidate.actionText,
    candidate.kind,
  );
  for (const entry of history.slice(0, 8)) {
    const ageMs = now - entry.at;
    if (ageMs > 6 * 60 * 60_000) {
      continue;
    }
    const entryText = [
      entry.practicalHook,
      entry.replyText,
      entry.linkNarrative,
    ]
      .filter(Boolean)
      .join(" ");
    const sameKind =
      entry.adviceCandidateKind === candidate.kind ||
      entry.initiativeMove === candidate.kind;
    const sameArchetype =
      candidateArchetype &&
      candidateArchetype ===
        classifyAdviceArchetype(
          entryText,
          entry.adviceCandidateKind ?? entry.initiativeMove,
        );
    const overlap =
      Math.max(
        adviceTokenOverlap(candidate.actionText, entry.practicalHook),
        adviceTokenOverlap(candidate.actionText, entry.replyText),
      );
    if (sameKind || sameArchetype || overlap >= 0.32) {
      similarCount += 1;
      penalty += sameKind ? 0.55 : 0.28;
      if (sameArchetype) penalty += 0.45;
      if (overlap >= 0.32) penalty += 0.25;
      if (!entry.feedback) penalty += 0.15;
    }
  }
  if (similarCount >= 2) {
    penalty += 0.55;
  }
  return penalty;
}

function selectAdviceCandidate(
  ranked: AdviceCandidate[],
  facts: ProactiveSignalFact[],
  history: AdviceLedgerEntry[],
  outcomes: AdviceOutcomeRecord[],
): AdviceCandidate | null {
  const hasEvidence = (candidate: AdviceCandidate) =>
    candidate.evidenceIds.length > 0 || candidate.kind === "rest";
  const isNovel = (candidate: AdviceCandidate) =>
    evaluateAdviceCandidateNovelty({
      candidate,
      recentEntries: history,
    }).length === 0;

  for (const candidate of ranked) {
    if (candidate.score >= 0.75 && hasEvidence(candidate) && isNovel(candidate)) {
      return candidate;
    }
  }
  for (const candidate of ranked) {
    if (candidate.score >= 0.55 && hasEvidence(candidate) && isNovel(candidate)) {
      return candidate;
    }
  }

  const clip = factByKind(facts, "clipboard");
  if (clip) {
    const quote = clip.detail.slice(0, 120);
    return makeCandidate(
      {
        id: "clarifying-probe-clipboard",
        kind: "clarifying_probe",
        evidenceIds: [clip.id],
        actionText: `Прямо процитируй буфер «${quote}» и спроси, это текущая отладка или отвлечённый фрагмент.`,
        expectedUtility: 0.52,
        interruptionCost: 0.28,
        confidence: 0.6,
        reason: "уточняющая привязка к буферу после отклонения повторных советов",
      },
      history,
      outcomes,
    );
  }

  return null;
}

export function planAdvice(input: {
  bundle: InitiativeSignalBundle;
  facts: ProactiveSignalFact[];
  urgency?: AdviceUrgency;
  feedback?: AdviceLedgerEntry[];
  history?: AdviceLedgerEntry[];
  outcomes?: AdviceOutcomeRecord[];
  candidateTopics?: string[];
  ragSnippets?: string[];
}): AdvicePlan {
  const { bundle, facts } = input;
  const feedback = input.feedback ?? [];
  const history = [
    ...feedback,
    ...(input.history ?? []).filter(
      (entry) => !feedback.some((item) => item.id === entry.id),
    ),
  ];
  const outcomes = input.outcomes ?? [];
  const candidates: AdviceCandidate[] = [];
  const file = factByKind(facts, "file");
  const clip = factByKind(facts, "clipboard");
  const urgency = factByKind(facts, "urgency");
  const task = facts.find((fact) => fact.id.startsWith("task:link")) ??
    factByKind(facts, "task");
  const query = factsByKind(facts, "query")[0];
  const reference = factByKind(facts, "reference");
  const screen = factByKind(facts, "screen");
  const hypotheses = buildAdvisorHypotheses(bundle, facts);
  const topHypothesis = hypotheses[0];
  const hasStackClip = Boolean(
    clip?.kind === "clipboard" &&
      /error|exception|traceback|panic|failed|ошиб|stack|assert/i.test(clip.detail),
  );

  for (const hypothesis of hypotheses) {
    if (
      hypothesis.kind === "test_failure" &&
      !hasStackClip &&
      hypothesis.evidenceFactIds.length
    ) {
      candidates.push(
        makeCandidate(
          {
            id: "test-failure-triage",
            kind: "test_failure_triage",
            evidenceIds: hypothesis.evidenceFactIds,
            actionText: file
              ? `Опираясь на видимое падение теста, предложи проверить первый expected/received и ближайшее изменение в ${file.detail}, без общего чеклиста.`
              : "Опираясь на видимое падение теста, предложи начать с первого expected/received и одного минимального воспроизведения.",
            expectedUtility: 0.88,
            interruptionCost: 0.22,
            confidence: hypothesis.confidence,
            reason: hypothesis.claim,
          },
          history,
          outcomes,
        ),
      );
    }

    if (
      hypothesis.kind === "terminal_error" &&
      hypothesis.evidenceFactIds.length
    ) {
      const terminalQuote = clip ? ` «${clip.detail.slice(0, 160)}»` : "";
      candidates.push(
        makeCandidate(
          {
            id: "terminal-error-triage",
            kind: "terminal_error_triage",
            evidenceIds: hypothesis.evidenceFactIds,
            actionText: file
              ? `Свяжи ошибку${terminalQuote} с ${file.detail}: предложи проверить ближайший файл/строку из сообщения и одно последнее изменение.`
              : `Свяжи ошибку${terminalQuote} с текущим окном: предложи выделить первый файл/строку из сообщения и проверить одну гипотезу.`,
            expectedUtility: 0.84,
            interruptionCost: 0.24,
            confidence: hypothesis.confidence,
            reason: hypothesis.claim,
          },
          history,
          outcomes,
        ),
      );
    }

    if (hypothesis.kind === "clipboard_solution" && clip) {
      const semantics = describeClipboardSemantics(clip.detail);
      const semanticInstruction = semantics
        ? ` Используй элементы из буфера как якорь: ${semantics}.`
        : "";
      candidates.push(
        makeCandidate(
          {
            id: "clipboard-solution",
            kind: clip.detail.match(/https?:\/\/|www\./i)
              ? "docs_lookup"
              : "debug_next_step",
            evidenceIds: hypothesis.evidenceFactIds,
            actionText: file
              ? `Разбери буфер «${clip.detail.slice(0, 160)}» как главный факт и привяжи к ${file.detail}.${semanticInstruction} Дай гипотезу по связи этих элементов, один конкретный следующий шаг и проверку результата. Не задавай уточняющий вопрос и не уходи в общий комментарий по файлу.`
              : `Разбери буфер «${clip.detail.slice(0, 180)}».${semanticInstruction} Дай гипотезу по связи этих элементов, один конкретный следующий шаг и проверку результата. Не задавай уточняющий вопрос.`,
            expectedUtility: 0.88,
            interruptionCost: 0.18,
            confidence: hypothesis.confidence,
            reason: hypothesis.claim,
          },
          history,
          outcomes,
        ),
      );
    }

    if (
      hypothesis.kind === "docs_to_code" &&
      query &&
      file &&
      bundle.taskActivityLink?.confidence !== "strong"
    ) {
      candidates.push(
        makeCandidate(
          {
            id: "docs-to-code-bridge",
            kind: "docs_to_code_bridge",
            evidenceIds: hypothesis.evidenceFactIds,
            actionText: `Свяжи поиск «${query.detail.slice(0, 80)}» с ${file.detail}: предложи одну проверку в коде или один вопрос, который подтвердит, что доки применимы здесь.`,
            expectedUtility: 0.74,
            interruptionCost: hypothesis.suggestedMove === "ask" ? 0.3 : 0.25,
            confidence: hypothesis.confidence,
            reason: hypothesis.claim,
          },
          history,
          outcomes,
        ),
      );
    }

    if (hypothesis.kind === "stale_context") {
      candidates.push(
        makeCandidate(
          {
            id: "stale-context-warning",
            kind: "stale_context_warning",
            evidenceIds: hypothesis.evidenceFactIds,
            actionText: `Коротко уточни, это всё ещё про задачу «${bundle.taskActivityLink?.taskTitle?.slice(0, 80) ?? task?.detail.slice(0, 80) ?? "текущую задачу"}», прежде чем давать следующий шаг.`,
            expectedUtility: 0.66,
            interruptionCost: 0.24,
            confidence: hypothesis.confidence,
            reason: hypothesis.claim,
          },
          history,
          outcomes,
        ),
      );
    }

    if (hypothesis.kind === "stuck_before_search" && file) {
      candidates.push(
        makeCandidate(
          {
            id: "stuck-before-search",
            kind: "debug_next_step",
            evidenceIds: hypothesis.evidenceFactIds,
            actionText: `Предположи узкое место в ${file.detail} до того, как пользователь пойдёт искать: проверь последний изменённый блок, его входные данные и один наблюдаемый выход. Дай конкретную гипотезу, проверку и критерий "починилось/нет".`,
            expectedUtility: 0.86,
            interruptionCost: 0.22,
            confidence: hypothesis.confidence,
            reason: hypothesis.claim,
          },
          history,
          outcomes,
        ),
      );
    }
  }

  const inputFriction = bundle.advisor.activitySummary.inputFrictionScore;
  if (
    file &&
    inputFriction >= 1 &&
    !candidates.some(
      (candidate) =>
        candidate.id === "stuck-before-search" ||
        candidate.kind === "debug_next_step",
    )
  ) {
    candidates.push(
      makeCandidate(
        {
          id: "keyboard-friction-next-step",
          kind: "debug_next_step",
          evidenceIds: [file.id, urgency?.id].filter(Boolean) as string[],
          actionText: `По ${file.detail} виден keyboard/input friction: не предлагай перерыв. Дай одну вероятную причину застревания, проверку ближайшего изменённого блока и конкретный критерий результата.`,
          expectedUtility: 0.82,
          interruptionCost: 0.2,
          confidence: Math.min(0.82, 0.58 + inputFriction * 0.08),
          reason: `keyboard/input friction ${inputFriction.toFixed(1)} в текущем IDE-контексте`,
        },
        history,
        outcomes,
      ),
    );
  }

  const substantiveClip =
    clip &&
    (isClipboardSemanticallyRich(clip.detail) ||
      /error|exception|failed|cannot|denied|not found|traceback|panic|function|const|class|import|def |https?:\/\/|www\.|ошиб/i.test(
        clip.detail,
      ));
  if (clip && !substantiveClip) {
    const quote = clip.detail.slice(0, 120);
    candidates.push(
      makeCandidate(
        {
          id: "clipboard-probe",
          kind: "clarifying_probe",
          evidenceIds: [clip.id, file?.id].filter(Boolean) as string[],
          actionText: file
            ? `Процитируй буфер «${quote}» и предложи один проверяемый шаг по ${file.detail}, опираясь на этот фрагмент.`
            : `Процитируй буфер «${quote}» и спроси, относится ли он к текущей задаче, прежде чем советовать дальше.`,
          expectedUtility: 0.86,
          interruptionCost: 0.22,
          confidence: 0.8,
          reason: "свежий фрагмент в буфере требует конкретной привязки",
        },
        history,
        outcomes,
      ),
    );
  }

  if (
    clip?.detail.match(/error|exception|traceback|panic|failed|ошиб/i) ||
    bundle.advisor.repeatedErrorSignature ||
    bundle.advisor.stuckScore >= 0.45
  ) {
    candidates.push(
      makeCandidate(
        {
          id: "debug-next-step",
          kind: "debug_next_step",
          evidenceIds: [clip?.id, file?.id, urgency?.id].filter(
            Boolean,
          ) as string[],
          actionText: file
            ? `Проверь ближайшее изменение в ${file.detail}; если ошибка из буфера «${clip?.detail.slice(0, 120) ?? ""}» относится к нему, начни с места, где появляется первый stack frame или импорт.`
            : clip
              ? `Начни с первой строки ошибки из буфера «${clip.detail.slice(0, 120)}»: выдели тип ошибки и ближайший файл/строку, а не весь stacktrace.`
              : "Сузь отладку до одной гипотезы и проверь её перед новым переключением контекста.",
          expectedUtility: 0.9,
          interruptionCost: 0.25,
          confidence: clip || file ? 0.82 : 0.62,
          reason: "есть свежий debug/stuck сигнал",
        },
        history,
        outcomes,
      ),
    );
  }

  if (bundle.taskActivityLink?.confidence === "strong" && task) {
    candidates.push(
      makeCandidate(
        {
          id: "task-bridge",
          kind: "task_bridge",
          evidenceIds: [task.id, file?.id].filter(Boolean) as string[],
          actionText: `Свяжи текущую активность с задачей «${task.detail.slice(0, 80)}» и предложи один следующий шаг по ней.`,
          expectedUtility: 0.78,
          interruptionCost: 0.35,
          confidence: 0.78,
          reason: "активность уверенно совпала с открытой задачей",
        },
        history,
        outcomes,
      ),
    );
  }

  if (bundle.advisor.scopeCreep || bundle.advisor.openTaskCount >= 6) {
    candidates.push(
      makeCandidate(
        {
          id: "scope-cut",
          kind: "scope_cut",
          evidenceIds: [task?.id, file?.id].filter(Boolean) as string[],
          actionText: `Сузь scope: выбери один хвост из ${bundle.advisor.openTaskCount} открытых задач и предложи самый маленький следующий шаг.`,
          expectedUtility: 0.72,
          interruptionCost: 0.38,
          confidence: 0.7,
          reason: "много открытых задач или контекстов",
        },
        history,
        outcomes,
      ),
    );
  }

  if (bundle.advisor.contextThrash) {
    candidates.push(
      makeCandidate(
        {
          id: "refocus",
          kind: "refocus",
          evidenceIds: factsByKind(facts, "wm").map((fact) => fact.id),
          actionText: "Предложи 10 минут без переключений: один файл, одна проверка, один результат.",
          expectedUtility: 0.7,
          interruptionCost: 0.32,
          confidence: 0.68,
          reason: "заметны частые переключения контекста",
        },
        history,
        outcomes,
      ),
    );
  }

  const recentRestAdvice = hasRecentAdviceKind(history, "rest");
  const clipboardNeedsAnswer = Boolean(
    clip &&
      (isClipboardSemanticallyRich(clip.detail) ||
        /error|exception|failed|cannot|denied|not found|traceback|panic|function|const|class|import|def |https?:\/\/|www\.|ошиб/i.test(
          clip.detail,
        )),
  );
  const workNeedsAnswer =
    Boolean(file) &&
    (bundle.advisor.activitySummary.inputFrictionScore >= 1 ||
      bundle.advisor.stuckScore >= 0.45 ||
      Boolean(clipboardNeedsAnswer || query || reference));
  if (bundle.advisor.breakDue && !recentRestAdvice && !workNeedsAnswer) {
    candidates.push(
      makeCandidate(
        {
          id: "rest",
          kind: "rest",
          evidenceIds: [urgency?.id].filter(Boolean) as string[],
          actionText: `Мягко предложи короткий перерыв на ${bundle.advisor.focusPrefs.preferredBreakLengthMinutes} минут без нравоучений.`,
          expectedUtility: 0.62,
          interruptionCost: 0.25,
          confidence: 0.72,
          reason: "сессия достаточно длинная для паузы",
        },
        history,
        outcomes,
      ),
    );
  }

  if (reference || input.ragSnippets?.length) {
    const source = reference?.detail ?? input.ragSnippets?.[0] ?? "";
    candidates.push(
      makeCandidate(
        {
          id: "solution-lookup",
          kind: "solution_lookup",
          evidenceIds: [reference?.id, query?.id, file?.id, clip?.id].filter(
            Boolean,
          ) as string[],
          actionText: file
            ? `Из найденного фрагмента вытащи вероятную причину и предложи конкретный fix для ${file.detail}; опирайся на «${source.slice(0, 140)}», затем дай короткую проверку результата.`
            : `Из найденного фрагмента вытащи вероятную причину проблемы и предложи конкретный fix; опирайся на «${source.slice(0, 140)}», затем дай короткую проверку результата.`,
          expectedUtility: 0.9,
          interruptionCost: 0.25,
          confidence: reference ? 0.82 : 0.74,
          reason: "есть справочный фрагмент, из которого можно дать решение, а не только направление поиска",
        },
        history,
        outcomes,
      ),
    );
  }

  if (input.ragSnippets?.length || query) {
    candidates.push(
      makeCandidate(
        {
          id: "docs-lookup",
          kind: "docs_lookup",
          evidenceIds: [query?.id, file?.id].filter(Boolean) as string[],
          actionText: input.ragSnippets?.[0]
            ? `Используй найденный фрагмент как проверяемую подсказку, но привяжи её к текущему файлу или ошибке.`
            : `Недавний поиск «${query?.detail.slice(0, 80)}» можно связать с текущей работой одним конкретным вопросом или проверкой.`,
          expectedUtility: 0.64,
          interruptionCost: 0.33,
          confidence: input.ragSnippets?.length ? 0.72 : 0.58,
          reason: "есть свежий поиск или RAG-фрагмент",
        },
        history,
        outcomes,
      ),
    );
  }

  const useful = firstUsefulFeedback(history);
  if (useful) {
    candidates.push(
      makeCandidate(
        {
          id: "memory-pattern",
          kind: "memory_pattern",
          evidenceIds: [file?.id, clip?.id].filter(Boolean) as string[],
          actionText:
            useful.practicalHook ??
            useful.replyText?.slice(0, 180) ??
            "Повтори уже полезный паттерн: один факт контекста плюс один проверяемый шаг.",
          expectedUtility: 0.75,
          interruptionCost: 0.28,
          confidence: 0.66,
          reason: "по этой теме уже был полезный совет",
        },
        history,
        outcomes,
      ),
    );
  }

  if (!candidates.length && (file || clip)) {
    candidates.push(
      makeCandidate(
        {
          id: "clarifying-probe",
          kind: "clarifying_probe",
          evidenceIds: [file?.id, clip?.id].filter(Boolean) as string[],
          actionText: file
            ? `Спроси коротко, где именно сейчас упирается работа в ${file.detail}, не выдавая общий совет.`
            : "Спроси, относится ли свежий буфер к текущей задаче, прежде чем советовать.",
          expectedUtility: 0.5,
          interruptionCost: 0.3,
          confidence: 0.58,
          reason: "сигнал есть, но полезный шаг неочевиден",
        },
        history,
        outcomes,
      ),
    );
  }

  if (!candidates.length && screen && topHypothesis?.kind === "uncertain") {
    candidates.push(
      makeCandidate(
        {
          id: "uncertainty-probe",
          kind: "uncertainty_probe",
          evidenceIds: topHypothesis.evidenceFactIds,
          actionText: file
            ? `Спроси одним коротким вопросом, где сейчас узкое место в ${file.detail}, и не выдавай общий совет без подтверждения.`
            : "Спроси одним коротким вопросом, что именно сейчас мешает, потому что контекст виден, но следующий шаг неочевиден.",
          expectedUtility: 0.48,
          interruptionCost: 0.2,
          confidence: topHypothesis.confidence,
          reason: topHypothesis.claim,
        },
        history,
        outcomes,
      ),
    );
  }

  const ranked = rerankAdviceCandidates(candidates, {
    bundle,
    facts,
    urgency: input.urgency,
    adviceReady: input.urgency ? input.urgency.level !== "none" : undefined,
  });
  const selected = selectAdviceCandidate(ranked, facts, history, outcomes);

  return {
    selected,
    candidates: ranked.slice(0, 5),
    reason: selected
      ? `выбран ${selected.kind}: ${selected.reason}`
      : "нет кандидата с достаточной пользой и опорой на текущие факты",
  };
}

export function formatAdviceCandidateForPrompt(
  candidate?: AdviceCandidate | null,
): string {
  if (!candidate) {
    return "";
  }
  return [
    `Тип совета: ${candidate.kind}`,
    `Действие: ${candidate.actionText}`,
    `Почему: ${candidate.reason}`,
    `Evidence: ${candidate.evidenceIds.join(", ") || "нет"}`,
    `Оценка: utility ${candidate.expectedUtility.toFixed(2)}, confidence ${candidate.confidence.toFixed(2)}, interruption ${candidate.interruptionCost.toFixed(2)}, score ${candidate.score.toFixed(2)}`,
  ].join("\n");
}
