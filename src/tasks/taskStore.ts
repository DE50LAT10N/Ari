import { notifyNew } from "../character/notifications";
import { loadJsonArray, saveJsonArray } from "../platform/jsonStorage";
import {
  freshnessBonus,
  overlapScore,
  queryWordSet,
} from "../memory/memoryScoring";
import {
  getCurrentGoal,
  inferGoalForText,
  recordTaskProgressForGoal,
} from "./goalLedger";
import type { AppSettings } from "../settings/appSettings";
import {
  inferGoalForTaskLocally,
  inferGoalForTaskWithLlm,
} from "./goalInference";

export type TaskKind = "task" | "thread" | "reminder" | "decision";
export type TaskStatus = "proposed" | "open" | "done" | "dismissed";
export type TaskPriority = "low" | "normal" | "high";
export type TaskSource =
  | "user"
  | "extracted"
  | "proposed"
  | "focus"
  | "safe_action"
  | "migrated";

export type TaskCategory =
  | "general"
  | "privacy"
  | "testing"
  | "feature"
  | "bug"
  | "research";

export type Task = {
  id: string;
  title: string;
  notes?: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: TaskPriority;
  category?: TaskCategory;
  projectId?: string;
  goalId?: string;
  dueAt?: number;
  reminderState?: "scheduled" | "reminded" | "snoozed";
  snoozeCount?: number;
  lastRemindedAt?: number;
  source: TaskSource;
  inboxKind?: string;
  confidence?: number;
  reason?: string;
  sourceMessage?: string;
  metadata?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
};

const STORAGE_KEY = "desktop-character.tasks.v1";
const MAX_TASKS = 400;

let tasksCache: Task[] | null = null;

export const TASKS_CHANGED_EVENT = "ari-tasks-changed";

function notify(): void {
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
  window.dispatchEvent(new Event("ari-backlog-changed"));
  window.dispatchEvent(new Event("ari-inbox-changed"));
  window.dispatchEvent(new Event("ari-episodic-memory-changed"));
}

function loadRaw(): Task[] {
  if (tasksCache) {
    return tasksCache;
  }
  tasksCache = loadJsonArray<Task>(STORAGE_KEY);
  return tasksCache;
}

function saveAll(tasks: Task[]): void {
  tasksCache = tasks.slice(0, MAX_TASKS);
  saveJsonArray(STORAGE_KEY, tasksCache, MAX_TASKS);
  notify();
}

export type TaskFilter = {
  status?: TaskStatus | TaskStatus[];
  kind?: TaskKind | TaskKind[];
  priority?: TaskPriority;
  category?: TaskCategory;
  projectId?: string;
  includeDone?: boolean;
};

function matchesFilter(task: Task, filter?: TaskFilter): boolean {
  if (!filter) {
    return task.status !== "dismissed";
  }
  if (!filter.includeDone && (task.status === "done" || task.status === "dismissed")) {
    if (!filter.status) return false;
  }
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!statuses.includes(task.status)) return false;
  }
  if (filter.kind) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (!kinds.includes(task.kind)) return false;
  }
  if (filter.priority && task.priority !== filter.priority) return false;
  if (filter.category && task.category !== filter.category) return false;
  if (filter.projectId && task.projectId !== filter.projectId) return false;
  return true;
}

const priorityWeight: Record<TaskPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

export function loadTasks(filter?: TaskFilter): Task[] {
  return loadRaw().filter((task) => matchesFilter(task, filter));
}

export function getTaskById(id: string): Task | null {
  return loadRaw().find((task) => task.id === id) ?? null;
}

export function addTask(
  input: Omit<Task, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: number;
    updatedAt?: number;
  },
): Task {
  const now = Date.now();
  const task: Task = {
    id: input.id ?? crypto.randomUUID(),
    title: input.title.trim().slice(0, 300),
    notes: input.notes?.trim().slice(0, 2000),
    kind: input.kind,
    status: input.status,
    priority: input.priority ?? "normal",
    category: input.category,
    projectId: input.projectId,
    goalId: input.goalId ?? inferGoalForText(`${input.title} ${input.notes ?? ""}`)?.id,
    dueAt: input.dueAt,
    reminderState:
      input.reminderState ?? (input.dueAt ? "scheduled" : undefined),
    snoozeCount: input.snoozeCount ?? 0,
    lastRemindedAt: input.lastRemindedAt,
    source: input.source,
    inboxKind: input.inboxKind,
    confidence: input.confidence,
    reason: input.reason,
    sourceMessage: input.sourceMessage?.slice(0, 1000),
    metadata: input.metadata,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    resolvedAt: input.resolvedAt,
  };

  const tasks = [...loadRaw()];
  const isDuplicateProposed =
    task.status === "proposed" &&
    tasks.some(
      (existing) =>
        existing.status === "proposed" &&
        existing.title.toLowerCase() === task.title.toLowerCase(),
    );
  if (!isDuplicateProposed) {
    tasks.unshift(task);
    saveAll(tasks);
    if (task.status === "proposed") {
      notifyNew("task_proposed", task.title);
    } else if (task.status === "open") {
      notifyNew("task", task.title);
    }
  }
  return task;
}

function updateTaskRecord(
  id: string,
  patch: Partial<Task>,
): Task | null {
  const tasks = [...loadRaw()];
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return null;
  tasks[index] = {
    ...tasks[index],
    ...patch,
    title: patch.title?.trim().slice(0, 300) ?? tasks[index].title,
    notes: patch.notes?.trim().slice(0, 2000) ?? tasks[index].notes,
    updatedAt: Date.now(),
  };
  saveAll(tasks);
  return tasks[index];
}

export function updateTask(id: string, patch: Partial<Task>): Task | null {
  return updateTaskRecord(id, patch);
}

export function completeTask(id: string): Task | null {
  const task = getTaskById(id);
  const inferred = task ? inferGoalForTaskLocally(task) : null;
  const completed = updateTaskRecord(id, {
    status: "done",
    resolvedAt: Date.now(),
    goalId: inferred?.goal?.id ?? task?.goalId,
    metadata: inferred?.goal
      ? {
          ...task?.metadata,
          goalInferenceSource: inferred.source,
          goalInferenceConfidence: inferred.confidence.toFixed(2),
        }
      : task?.metadata,
  });
  if (completed) {
    recordTaskProgressForGoal(completed);
  }
  return completed;
}

export async function completeTaskWithGoalInference(
  id: string,
  settings: AppSettings,
): Promise<Task | null> {
  const task = getTaskById(id);
  if (!task) {
    return null;
  }
  const inferred = await inferGoalForTaskWithLlm(task, settings);
  const completed = updateTaskRecord(id, {
    status: "done",
    resolvedAt: Date.now(),
    goalId: inferred.goal?.id ?? task.goalId,
    metadata: inferred.goal
      ? {
          ...task.metadata,
          goalInferenceSource: inferred.source,
          goalInferenceConfidence: inferred.confidence.toFixed(2),
        }
      : task.metadata,
  });
  if (completed) {
    recordTaskProgressForGoal(completed);
  }
  return completed;
}

export function dismissTask(id: string): Task | null {
  return updateTaskRecord(id, {
    status: "dismissed",
    resolvedAt: Date.now(),
  });
}

export function reopenTask(id: string): Task | null {
  const task = getTaskById(id);
  if (!task) return null;
  return updateTaskRecord(id, {
    status: "open",
    resolvedAt: undefined,
    reminderState: task.dueAt ? "scheduled" : undefined,
  });
}

export function snoozeTask(id: string, delayMs: number): Task | null {
  const task = getTaskById(id);
  if (!task || task.status !== "open") return null;
  return updateTaskRecord(id, {
    dueAt: Date.now() + Math.max(60_000, delayMs),
    reminderState: "snoozed",
    snoozeCount: (task.snoozeCount ?? 0) + 1,
  });
}

export function markTaskReminded(id: string): Task | null {
  const task = getTaskById(id);
  if (!task || task.status !== "open") return null;
  return updateTaskRecord(id, {
    reminderState: "reminded",
    lastRemindedAt: Date.now(),
  });
}

export function confirmProposedTask(
  id: string,
  patch: Partial<Pick<Task, "title" | "notes" | "dueAt" | "priority" | "kind">> = {},
): Task | null {
  const task = getTaskById(id);
  if (!task || task.status !== "proposed") return null;
  return updateTaskRecord(id, {
    ...patch,
    status: "open",
    source: task.source === "proposed" ? "user" : task.source,
    reminderState: (patch.dueAt ?? task.dueAt) ? "scheduled" : undefined,
  });
}

export function deferTask(id: string): Task | null {
  return snoozeTask(id, 24 * 60 * 60_000);
}

export function countOpenTasks(): number {
  return loadTasks({ status: "open" }).length;
}

export function countProposedTasks(): number {
  return loadTasks({ status: "proposed" }).length;
}

export function getNextTask(category?: TaskCategory): Task | null {
  const currentGoal = getCurrentGoal();
  const open = loadTasks({ status: "open", category }).sort((left, right) => {
    if (currentGoal) {
      const leftCurrent = left.goalId === currentGoal.id ? 1 : 0;
      const rightCurrent = right.goalId === currentGoal.id ? 1 : 0;
      if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent;
    }
    const priorityDelta =
      priorityWeight[right.priority] - priorityWeight[left.priority];
    if (priorityDelta !== 0) return priorityDelta;
    if (left.dueAt && right.dueAt) return left.dueAt - right.dueAt;
    if (left.dueAt) return -1;
    if (right.dueAt) return 1;
    return left.createdAt - right.createdAt;
  });
  return open[0] ?? null;
}

export function getDueTasks(now = Date.now()): Task[] {
  return loadTasks({ status: "open" }).filter(
    (task) =>
      Boolean(task.dueAt && task.dueAt <= now) &&
      task.reminderState !== "reminded",
  );
}

export function getHighPriorityOpenTasks(): Task[] {
  return loadTasks({ status: "open", priority: "high" });
}

export function selectOpenTaskContext(
  query: string,
  limit = 6,
): Task[] {
  const words = queryWordSet(query);
  const open = loadTasks({ status: "open" });
  return open
    .map((task, index) => ({
      task,
      score:
        overlapScore(`${task.title} ${task.notes ?? ""}`, words) * 10 +
        (task.dueAt ? 4 : 0) +
        priorityWeight[task.priority] +
        freshnessBonus(task.updatedAt) +
        1 / (index + 1),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ task }) => task);
}

export function formatTaskList(tasks: Task[]): string {
  if (!tasks.length) return "нет открытых задач";
  return tasks
    .slice(0, 8)
    .map((task) => {
      const due = task.dueAt
        ? ` (до ${new Date(task.dueAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})`
        : "";
      return `• ${task.title}${due}`;
    })
    .join("\n");
}

export function invalidateTaskCache(): void {
  tasksCache = null;
}

if (typeof window !== "undefined") {
  window.addEventListener(TASKS_CHANGED_EVENT, () => {
    tasksCache = null;
  });
}
