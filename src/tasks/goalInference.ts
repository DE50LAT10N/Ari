import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import {
  getGoalById,
  loadGoals,
  rankGoalsForText,
  type Goal,
} from "./goalLedger";

export type GoalInferenceInput = {
  title: string;
  notes?: string;
  category?: string;
  sourceMessage?: string;
};

export type GoalInferenceResult = {
  goal: Goal | null;
  source: "llm" | "local" | "none";
  confidence: number;
};

type GoalChoiceResponse = {
  goalId?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

function taskText(task: GoalInferenceInput): string {
  return [
    task.title,
    task.notes,
    task.category,
    task.sourceMessage,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1200);
}

export function inferGoalForTaskLocally(
  task: GoalInferenceInput,
): GoalInferenceResult {
  const goals = loadGoals();
  if (!goals.length) {
    return { goal: null, source: "none", confidence: 0 };
  }
  if (goals.length === 1) {
    return { goal: goals[0], source: "local", confidence: 0.6 };
  }
  const ranked = rankGoalsForText(taskText(task));
  const best = ranked[0];
  if (!best || best.score < 1) {
    return { goal: null, source: "none", confidence: 0 };
  }
  const second = ranked[1];
  const margin = best.score - (second?.score ?? 0);
  return {
    goal: best.goal,
    source: "local",
    confidence: Math.min(0.95, 0.45 + best.score * 0.12 + margin * 0.08),
  };
}

export async function inferGoalForTaskWithLlm(
  task: GoalInferenceInput,
  settings: AppSettings,
): Promise<GoalInferenceResult> {
  const goals = loadGoals();
  if (!goals.length) {
    return { goal: null, source: "none", confidence: 0 };
  }
  if (goals.length === 1) {
    return { goal: goals[0], source: "local", confidence: 0.6 };
  }

  const local = inferGoalForTaskLocally(task);
  const shortlist = rankGoalsForText(taskText(task))
    .slice(0, Math.min(8, goals.length))
    .map(({ goal }) => goal);
  const candidates = shortlist.length ? shortlist : goals.slice(0, 8);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "Ты выбираешь, к какой цели пользователя относится завершённая задача.",
        "Верни только JSON: {\"goalId\":\"id из списка или null\",\"confidence\":0..1,\"reason\":\"коротко\"}.",
        "Если связь слабая или неоднозначная, верни goalId:null и низкую confidence.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Задача: ${task.title}`,
        task.notes ? `Заметки: ${task.notes}` : "",
        task.category ? `Категория: ${task.category}` : "",
        task.sourceMessage ? `Фраза пользователя: ${task.sourceMessage}` : "",
        "",
        "Цели:",
        ...candidates.map((goal) =>
          [
            `[${goal.id}] ${goal.title}`,
            `progress=${goal.progress}%`,
            goal.current ? "current=true" : "",
            goal.notes ? `notes=${goal.notes.slice(0, 220)}` : "",
            goal.lastFocus ? `lastFocus=${goal.lastFocus.slice(0, 220)}` : "",
          ]
            .filter(Boolean)
            .join("; "),
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  try {
    const response = await completeLlmJson<GoalChoiceResponse>(
      messages,
      settings,
      160,
      "json",
    );
    const goalId = typeof response.goalId === "string" ? response.goalId : "";
    const confidence =
      typeof response.confidence === "number" ? response.confidence : 0;
    const goal = getGoalById(goalId);
    if (goal && confidence >= 0.45) {
      return {
        goal,
        source: "llm",
        confidence: Math.max(0, Math.min(1, confidence)),
      };
    }
  } catch {
    // Fall back to deterministic local scoring below.
  }

  return local;
}
