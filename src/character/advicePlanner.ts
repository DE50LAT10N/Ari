import type { AdviceLedgerEntry } from "./adviceLedger";
import type { AdviceUrgency } from "./adviceUrgency";
import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";

export type AdviceCandidateKind =
  | "debug_next_step"
  | "clarifying_probe"
  | "task_bridge"
  | "scope_cut"
  | "refocus"
  | "rest"
  | "docs_lookup"
  | "memory_pattern";

export type AdviceCandidate = {
  id: string;
  kind: AdviceCandidateKind;
  evidenceIds: string[];
  actionText: string;
  expectedUtility: number;
  interruptionCost: number;
  confidence: number;
  reason: string;
  score: number;
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
  return facts.find((fact) => fact.kind === kind);
}

function factsByKind(
  facts: ProactiveSignalFact[],
  kind: ProactiveSignalFact["kind"],
): ProactiveSignalFact[] {
  return facts.filter((fact) => fact.kind === kind);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function feedbackBonus(
  candidate: Omit<AdviceCandidate, "score">,
  feedback: AdviceLedgerEntry[],
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
  return bonus;
}

function scoreCandidate(
  candidate: Omit<AdviceCandidate, "score">,
  feedback: AdviceLedgerEntry[],
): AdviceCandidate {
  const score =
    candidate.expectedUtility * 1.4 +
    candidate.confidence +
    feedbackBonus(candidate, feedback) -
    candidate.interruptionCost;
  return { ...candidate, score };
}

function makeCandidate(
  input: Omit<AdviceCandidate, "score">,
  feedback: AdviceLedgerEntry[],
): AdviceCandidate {
  return scoreCandidate(input, feedback);
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

export function planAdvice(input: {
  bundle: InitiativeSignalBundle;
  facts: ProactiveSignalFact[];
  urgency?: AdviceUrgency;
  feedback?: AdviceLedgerEntry[];
  candidateTopics?: string[];
  ragSnippets?: string[];
}): AdvicePlan {
  const { bundle, facts } = input;
  const feedback = input.feedback ?? [];
  const candidates: AdviceCandidate[] = [];
  const file = factByKind(facts, "file");
  const clip = factByKind(facts, "clipboard");
  const urgency = factByKind(facts, "urgency");
  const task = facts.find((fact) => fact.id.startsWith("task:link")) ??
    factByKind(facts, "task");
  const query = factsByKind(facts, "query")[0];

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
            ? `Проверь ближайшее изменение в ${file.detail}; если ошибка из буфера относится к нему, начни с места, где появляется первый stack frame или импорт.`
            : clip
              ? `Начни с первой строки ошибки из буфера: выдели тип ошибки и ближайший файл/строку, а не весь stacktrace.`
              : "Сузь отладку до одной гипотезы и проверь её перед новым переключением контекста.",
          expectedUtility: 0.9,
          interruptionCost: 0.25,
          confidence: clip || file ? 0.82 : 0.62,
          reason: "есть свежий debug/stuck сигнал",
        },
        feedback,
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
        feedback,
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
        feedback,
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
        feedback,
      ),
    );
  }

  if (bundle.advisor.breakDue) {
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
        feedback,
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
        feedback,
      ),
    );
  }

  const useful = firstUsefulFeedback(feedback);
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
        feedback,
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
        feedback,
      ),
    );
  }

  const ranked = candidates.sort((left, right) => right.score - left.score);
  const selected = ranked.find(
    (candidate) =>
      candidate.score >= 0.75 &&
      (candidate.evidenceIds.length > 0 || candidate.kind === "rest"),
  ) ?? null;

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
