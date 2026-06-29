import {
  addTask,
  completeTask,
  countOpenTasks,
  deferTask,
  getNextTask,
  loadTasks,
  type Task,
  type TaskCategory,
  type TaskPriority,
} from "../tasks/taskStore";

export type BacklogStatus = "open" | "done" | "deferred";
export type BacklogPriority = TaskPriority;
export type BacklogCategory = TaskCategory;

export type AriBacklogItem = {
  id: string;
  title: string;
  notes?: string;
  category: BacklogCategory;
  priority: BacklogPriority;
  status: BacklogStatus;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  dueAt?: number;
};

function toBacklogItem(task: Task): AriBacklogItem {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    category: task.category ?? "general",
    priority: task.priority,
    status:
      task.status === "done"
        ? "done"
        : task.snoozeCount && task.dueAt && task.dueAt > Date.now()
          ? "deferred"
          : "open",
    projectId: task.projectId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    dueAt: task.dueAt,
  };
}

export function loadBacklogItems(filters?: {
  category?: BacklogCategory;
  priority?: BacklogPriority;
  status?: BacklogStatus;
  projectId?: string;
}): AriBacklogItem[] {
  const tasks = loadTasks({
    kind: ["task", "reminder"],
    includeDone: true,
    category: filters?.category,
    priority: filters?.priority,
    projectId: filters?.projectId,
  });
  return tasks
    .map(toBacklogItem)
    .filter((item) => {
      if (!filters?.status) return item.status === "open";
      return item.status === filters.status;
    });
}

export function addBacklogItem(input: {
  title: string;
  notes?: string;
  category?: BacklogCategory;
  priority?: BacklogPriority;
  projectId?: string;
  dueAt?: number;
}): AriBacklogItem {
  const task = addTask({
    title: input.title,
    notes: input.notes,
    kind: input.dueAt ? "reminder" : "task",
    status: "open",
    priority: input.priority ?? "normal",
    category: input.category ?? "general",
    projectId: input.projectId,
    dueAt: input.dueAt,
    source: "user",
  });
  return toBacklogItem(task);
}

export function getNextBacklogItem(
  category?: BacklogCategory,
): AriBacklogItem | null {
  const task = getNextTask(category);
  if (!task || (task.kind !== "task" && task.kind !== "reminder")) {
    return null;
  }
  return toBacklogItem(task);
}

export function deferBacklogItem(id: string): void {
  deferTask(id);
}

export function completeBacklogItem(id: string): void {
  completeTask(id);
}

export function countOpenBacklogItems(): number {
  return countOpenTasks();
}
