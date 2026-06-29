import { addTask, loadTasks } from "../tasks/taskStore";

export type DecisionStatus = "open" | "decided" | "superseded";

export type DecisionRecord = {
  id: string;
  title: string;
  context: string;
  decision?: string;
  alternatives: string[];
  projectId?: string;
  status: DecisionStatus;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
};

export function loadDecisionRecords(projectId?: string): DecisionRecord[] {
  const tasks = loadTasks({ kind: "decision", includeDone: true });
  const records = tasks.map(
    (task): DecisionRecord => ({
      id: task.id,
      title: task.title,
      context: task.notes ?? "",
      decision: task.status === "done" ? task.notes : undefined,
      alternatives: [],
      projectId: task.projectId,
      status: task.status === "done" ? "decided" : "open",
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      decidedAt: task.resolvedAt,
    }),
  );
  return projectId
    ? records.filter((record) => record.projectId === projectId)
    : records;
}

export function createDecisionRecord(input: {
  title: string;
  context: string;
  alternatives?: string[];
  projectId?: string;
}): DecisionRecord {
  const task = addTask({
    title: input.title,
    notes: [input.context, ...(input.alternatives ?? [])].join("\n"),
    kind: "decision",
    status: "open",
    priority: "normal",
    projectId: input.projectId,
    source: "user",
  });
  return {
    id: task.id,
    title: task.title,
    context: input.context,
    alternatives: input.alternatives ?? [],
    projectId: task.projectId,
    status: "open",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
