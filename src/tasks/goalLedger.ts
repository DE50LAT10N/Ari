import { clamp } from "../platform/mathUtils";
import { loadJsonArray, saveJsonArray } from "../platform/jsonStorage";
import { overlapScore, queryWordSet } from "../memory/memoryScoring";

export type GoalStatus = "active" | "paused" | "done" | "dismissed";

export type Goal = {
  id: string;
  title: string;
  status: GoalStatus;
  progress: number;
  momentum: number;
  current: boolean;
  notes?: string;
  lastFocus?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

const STORAGE_KEY = "desktop-character.goals.v1";
const MAX_GOALS = 120;
export const GOALS_CHANGED_EVENT = "ari-goals-changed";

let goalsCache: Goal[] | null = null;

function notify(): void {
  window.dispatchEvent(new Event(GOALS_CHANGED_EVENT));
  window.dispatchEvent(new Event("ari-tasks-changed"));
}

function clampProgress(value: number): number {
  return clamp(Math.round(value), 0, 100);
}

function loadRaw(): Goal[] {
  if (goalsCache) {
    return goalsCache;
  }
  goalsCache = loadJsonArray<Goal>(STORAGE_KEY).map((goal) => ({
    ...goal,
    progress: clampProgress(goal.progress ?? 0),
    momentum: Math.max(0, Math.round(goal.momentum ?? 0)),
    current: Boolean(goal.current),
  }));
  return goalsCache;
}

function saveAll(goals: Goal[]): void {
  goalsCache = goals.slice(0, MAX_GOALS);
  saveJsonArray(STORAGE_KEY, goalsCache, MAX_GOALS);
  notify();
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function goalMatchText(goal: Goal): string {
  return [
    goal.title,
    goal.notes,
    goal.lastFocus,
    goal.current ? "текущая current focus фокус" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function loadGoals(options: { includeDone?: boolean } = {}): Goal[] {
  return loadRaw().filter((goal) => {
    if (goal.status === "dismissed") return false;
    if (!options.includeDone && goal.status === "done") return false;
    return true;
  });
}

export function getGoalById(id?: string): Goal | null {
  if (!id) return null;
  return loadRaw().find((goal) => goal.id === id) ?? null;
}

export function getCurrentGoal(): Goal | null {
  return (
    loadGoals().find((goal) => goal.current && goal.status === "active") ??
    loadGoals().find((goal) => goal.status === "active") ??
    null
  );
}

export function addGoal(input: {
  title: string;
  notes?: string;
  progress?: number;
  current?: boolean;
}): Goal {
  const now = Date.now();
  const title = input.title.trim().slice(0, 300);
  const existing = loadRaw().find(
    (goal) => goal.status !== "dismissed" && normalize(goal.title) === normalize(title),
  );
  if (existing) {
    if (input.current) {
      setCurrentGoal(existing.id);
    }
    return existing;
  }

  const goal: Goal = {
    id: crypto.randomUUID(),
    title,
    notes: input.notes?.trim().slice(0, 1600),
    status: "active",
    progress: clampProgress(input.progress ?? 0),
    momentum: 0,
    current: input.current ?? loadGoals().length === 0,
    createdAt: now,
    updatedAt: now,
  };
  const next = goal.current
    ? loadRaw().map((item) => ({ ...item, current: false }))
    : [...loadRaw()];
  next.unshift(goal);
  saveAll(next);
  return goal;
}

export function findGoalByTitle(fragment: string): Goal | null {
  const normalized = normalize(fragment);
  if (!normalized) return null;
  const goals = loadGoals({ includeDone: true });
  return (
    goals.find((goal) => normalize(goal.title) === normalized) ??
    goals.find((goal) => normalize(goal.title).includes(normalized)) ??
    goals.find((goal) => normalized.includes(normalize(goal.title))) ??
    null
  );
}

export function setCurrentGoal(id: string): Goal | null {
  let selected: Goal | null = null;
  const goals = loadRaw().map((goal) => {
    const current = goal.id === id && goal.status === "active";
    if (current) {
      selected = { ...goal, current, updatedAt: Date.now() };
      return selected;
    }
    return { ...goal, current: false };
  });
  saveAll(goals);
  return selected;
}

export function ensureGoalForFocus(goalText: string): Goal {
  const existing = findGoalByTitle(goalText);
  if (existing && existing.status === "active") {
    setCurrentGoal(existing.id);
    updateGoal(existing.id, { lastFocus: `Фокус: ${goalText}`, current: true });
    return existing;
  }
  return addGoal({
    title: goalText,
    current: true,
    notes: "Создано из фокус-сессии Ari.",
  });
}

export function updateGoal(
  id: string,
  patch: Partial<Pick<Goal, "title" | "notes" | "status" | "progress" | "lastFocus" | "current">>,
): Goal | null {
  const goals = loadRaw();
  const index = goals.findIndex((goal) => goal.id === id);
  if (index < 0) return null;
  const nextGoal: Goal = {
    ...goals[index],
    ...patch,
    title: patch.title?.trim().slice(0, 300) ?? goals[index].title,
    notes: patch.notes?.trim().slice(0, 1600) ?? goals[index].notes,
    lastFocus: patch.lastFocus?.trim().slice(0, 500) ?? goals[index].lastFocus,
    progress:
      typeof patch.progress === "number"
        ? clampProgress(patch.progress)
        : goals[index].progress,
    updatedAt: Date.now(),
    completedAt: patch.status === "done" ? Date.now() : goals[index].completedAt,
  };
  const next = goals.map((goal, goalIndex) =>
    goalIndex === index
      ? nextGoal
      : patch.current
        ? { ...goal, current: false }
        : goal,
  );
  saveAll(next);
  return nextGoal;
}

export function recordGoalProgress(
  goalId: string,
  input: { delta?: number; progress?: number; focus?: string },
): Goal | null {
  const goal = getGoalById(goalId);
  if (!goal || goal.status === "dismissed") return null;
  const progress =
    typeof input.progress === "number"
      ? input.progress
      : goal.progress + (input.delta ?? 0);
  return updateGoal(goalId, {
    progress,
    lastFocus: input.focus ?? goal.lastFocus,
    status: progress >= 100 ? "done" : goal.status === "done" ? "active" : goal.status,
  });
}

export function rankGoalsForText(text: string): Array<{ goal: Goal; score: number }> {
  const normalized = normalize(text);
  if (!normalized) return [];
  const goals = loadGoals();
  const words = queryWordSet(text);
  return goals
    .map((goal) => {
      const title = normalize(goal.title);
      const direct =
        normalized.includes(title) || title.includes(normalized) ? 4 : 0;
      const lexical = overlapScore(goalMatchText(goal), words);
      const notes = goal.notes ? overlapScore(goal.notes, words) * 0.5 : 0;
      const current = goal.current ? 0.25 : 0;
      return { goal, score: direct + lexical + notes + current };
    })
    .sort((left, right) => right.score - left.score);
}

export function inferGoalForText(
  text: string,
  options: { fallbackToCurrent?: boolean; minScore?: number } = {},
): Goal | null {
  const ranked = rankGoalsForText(text);
  const best = ranked[0];
  const minScore = options.minScore ?? 1;
  if (best && best.score >= minScore) {
    return best.goal;
  }
  if (options.fallbackToCurrent ?? true) {
    return getCurrentGoal();
  }
  return null;
}

export function recordTaskProgressForGoal(task: {
  title: string;
  notes?: string;
  goalId?: string;
}): Goal | null {
  const text = `${task.title} ${task.notes ?? ""}`;
  const goal =
    (task.goalId ? getGoalById(task.goalId) : null) ??
    inferGoalForText(text, { fallbackToCurrent: loadGoals().length <= 1 });
  if (!goal || goal.status !== "active") return null;
  const delta = goal.progress < 70 ? 8 : goal.progress < 90 ? 4 : 2;
  return recordGoalProgress(goal.id, {
    delta,
    focus: `Закрыто: ${task.title}`,
  });
}

export function formatGoalLedgerForPrompt(limit = 4): string {
  const goals = loadGoals()
    .filter((goal) => goal.status === "active" || goal.current)
    .sort((left, right) => Number(right.current) - Number(left.current) || right.updatedAt - left.updatedAt)
    .slice(0, limit);
  if (!goals.length) return "";
  return goals
    .map((goal) =>
      [
        `${goal.current ? "Текущая цель" : "Цель"}: ${goal.title}`,
        `прогресс ${goal.progress}%`,
        goal.lastFocus ? `фокус: ${goal.lastFocus}` : "",
        goal.notes ? `заметки: ${goal.notes}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    )
    .join("\n");
}

export function invalidateGoalCache(): void {
  goalsCache = null;
}

if (typeof window !== "undefined") {
  window.addEventListener(GOALS_CHANGED_EVENT, () => {
    goalsCache = null;
  });
}
