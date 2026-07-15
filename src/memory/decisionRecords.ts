import { addTask, loadTasks, updateTask } from "../tasks/taskStore";

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

const DECISION_METADATA_VERSION = "1";

function parseAlternatives(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function storedStatus(value: string | undefined): DecisionStatus | undefined {
  return value === "open" || value === "decided" || value === "superseded"
    ? value
    : undefined;
}

export function loadDecisionRecords(projectId?: string): DecisionRecord[] {
  const tasks = loadTasks({ kind: "decision", includeDone: true });
  const records = tasks.map(
    (task): DecisionRecord => ({
      id: task.id,
      title: task.title,
      context: task.metadata?.decisionContext ?? task.notes ?? "",
      decision:
        task.metadata?.decision ??
        (task.status === "done" ? task.notes : undefined),
      alternatives: parseAlternatives(task.metadata?.decisionAlternatives),
      projectId: task.projectId,
      status:
        storedStatus(task.metadata?.decisionStatus) ??
        (task.status === "done"
          ? "decided"
          : task.status === "dismissed"
            ? "superseded"
            : "open"),
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
    metadata: {
      decisionMetadataVersion: DECISION_METADATA_VERSION,
      decisionContext: input.context.slice(0, 2_000),
      decisionAlternatives: JSON.stringify((input.alternatives ?? []).slice(0, 20)),
      decisionStatus: "open",
    },
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

export function decideDecisionRecord(
  id: string,
  decision: string,
): DecisionRecord | null {
  const current = loadDecisionRecords().find((record) => record.id === id);
  const normalized = decision.trim().slice(0, 2_000);
  if (!current || !normalized) return null;
  const task = updateTask(id, {
    status: "done",
    resolvedAt: Date.now(),
    notes: current.context,
    metadata: {
      decisionMetadataVersion: DECISION_METADATA_VERSION,
      decisionContext: current.context,
      decisionAlternatives: JSON.stringify(current.alternatives),
      decision: normalized,
      decisionStatus: "decided",
    },
  });
  if (!task) return null;
  return loadDecisionRecords().find((record) => record.id === id) ?? null;
}

export function supersedeDecisionRecord(id: string): DecisionRecord | null {
  const current = loadDecisionRecords().find((record) => record.id === id);
  if (!current) return null;
  const task = updateTask(id, {
    status: "dismissed",
    resolvedAt: Date.now(),
    metadata: {
      decisionMetadataVersion: DECISION_METADATA_VERSION,
      decisionContext: current.context,
      decisionAlternatives: JSON.stringify(current.alternatives),
      ...(current.decision ? { decision: current.decision } : {}),
      decisionStatus: "superseded",
    },
  });
  if (!task) return null;
  return loadDecisionRecords().find((record) => record.id === id) ?? null;
}
