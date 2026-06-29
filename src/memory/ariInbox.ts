import { addUserMemoryFacts, supersedeMemoryFacts } from "./userMemory";
import { getActiveProjectBinder } from "../character/projectBinder";
import { notifyNew } from "../character/notifications";
import { saveJsonArray, loadJsonArray } from "../platform/jsonStorage";
import {
  addTask,
  confirmProposedTask,
  dismissTask,
  loadTasks,
  countProposedTasks,
  snoozeTask,
  type Task,
} from "../tasks/taskStore";

export type AriInboxKind =
  | "memory"
  | "memory_conflict"
  | "reminder"
  | "open_thread"
  | "suggested_task"
  | "decision"
  | "project_note"
  | "failed_action"
  | "ask_later";

export type AriInboxStatus = "pending" | "kept" | "edited" | "dismissed" | "later";

export type AriInboxItem = {
  id: string;
  kind: AriInboxKind;
  title: string;
  body: string;
  sourceMessage?: string;
  confidence: number;
  reason: string;
  proposedAt: number;
  status: AriInboxStatus;
  projectId?: string;
  metadata?: Record<string, string>;
};

const MEMORY_STORAGE_KEY = "desktop-character.ari-memory-inbox.v1";
const MAX_MEMORY_ITEMS = 80;

const TASK_INBOX_KINDS = new Set<AriInboxKind>([
  "reminder",
  "open_thread",
  "suggested_task",
  "decision",
  "project_note",
  "failed_action",
  "ask_later",
]);

function notifyMemory(): void {
  window.dispatchEvent(new Event("ari-memory-inbox-changed"));
}

function loadMemoryInbox(): AriInboxItem[] {
  return loadJsonArray<AriInboxItem>(MEMORY_STORAGE_KEY);
}

function saveMemoryInbox(items: AriInboxItem[]): void {
  saveJsonArray(MEMORY_STORAGE_KEY, items, MAX_MEMORY_ITEMS);
  notifyMemory();
}

function taskToInboxItem(task: Task): AriInboxItem {
  return {
    id: task.id,
    kind: (task.inboxKind as AriInboxKind) ?? "suggested_task",
    title: task.title,
    body: task.notes ?? task.title,
    sourceMessage: task.sourceMessage,
    confidence: task.confidence ?? 0.7,
    reason: task.reason ?? "",
    proposedAt: task.createdAt,
    status: "pending",
    projectId: task.projectId,
    metadata: task.metadata,
  };
}

export function loadAriInbox(includeResolved = false): AriInboxItem[] {
  const proposed = loadTasks({ status: "proposed" }).map(taskToInboxItem);
  const memory = includeResolved
    ? loadMemoryInbox()
    : loadMemoryInbox().filter(
        (item) => item.status === "pending" || item.status === "later",
      );
  return [...proposed, ...memory];
}

export function countPendingInboxItems(): number {
  return countProposedTasks() + countPendingMemoryInboxItems();
}

function loadMemoryKindInbox(includeResolved = false): AriInboxItem[] {
  const items = loadMemoryInbox();
  return includeResolved
    ? items
    : items.filter((item) => item.status === "pending" || item.status === "later");
}

export function countPendingMemoryInboxItems(): number {
  return loadMemoryKindInbox().filter((item) => item.status === "pending").length;
}

function inboxKindToTaskKind(kind: AriInboxKind): Task["kind"] {
  switch (kind) {
    case "reminder":
      return "reminder";
    case "open_thread":
      return "thread";
    case "decision":
      return "decision";
    default:
      return "task";
  }
}

export function addToAriInbox(
  item: Omit<AriInboxItem, "id" | "proposedAt" | "status"> & {
    id?: string;
    proposedAt?: number;
    status?: AriInboxStatus;
  },
): AriInboxItem {
  const entry: AriInboxItem = {
    id: item.id ?? crypto.randomUUID(),
    kind: item.kind,
    title: item.title.trim().slice(0, 200) || item.body.trim().slice(0, 120),
    body: item.body.trim().slice(0, 2000),
    sourceMessage: item.sourceMessage?.trim().slice(0, 1000),
    confidence: Math.max(0, Math.min(1, item.confidence)),
    reason: item.reason.trim().slice(0, 300),
    proposedAt: item.proposedAt ?? Date.now(),
    status: item.status ?? "pending",
    projectId: item.projectId ?? getActiveProjectBinder()?.id,
    metadata: item.metadata,
  };

  if (item.kind === "memory" || item.kind === "memory_conflict") {
    const items = loadMemoryInbox();
    const duplicate = items.some(
      (existing) =>
        (existing.status === "pending" || existing.status === "later") &&
        existing.body.toLowerCase() === entry.body.toLowerCase(),
    );
    if (!duplicate) {
      items.unshift(entry);
      saveMemoryInbox(items);
    }
    return entry;
  }

  if (!TASK_INBOX_KINDS.has(item.kind)) {
    return entry;
  }

  addTask({
    id: entry.id,
    title: entry.title,
    notes: entry.body,
    kind: inboxKindToTaskKind(entry.kind),
    status: "proposed",
    priority: "normal",
    category:
      entry.kind === "failed_action"
        ? "bug"
        : entry.kind === "ask_later"
          ? "research"
          : "general",
    projectId: entry.projectId,
    dueAt: entry.metadata?.dueAt ? Number(entry.metadata.dueAt) : undefined,
    source: "proposed",
    inboxKind: entry.kind,
    confidence: entry.confidence,
    reason: entry.reason,
    sourceMessage: entry.sourceMessage,
    metadata: entry.metadata,
    createdAt: entry.proposedAt,
  });
  notifyNew("task_proposed", entry.title);
  return entry;
}

async function promoteMemoryInboxItem(
  item: AriInboxItem,
  editedBody?: string,
): Promise<void> {
  const body = (editedBody ?? item.body).trim();
  if (!body) return;

  if (item.kind === "memory") {
    await addUserMemoryFacts(
      [
        {
          text: body,
          importance:
            item.metadata?.importance === "core" ||
            item.metadata?.importance === "important"
              ? item.metadata.importance
              : "useful",
          confidence: item.confidence,
        },
      ],
      "manual",
    );
    return;
  }
  if (item.kind === "memory_conflict") {
    const conflictingIds =
      item.metadata?.conflictingIds?.split(",").filter(Boolean) ?? [];
    if (conflictingIds.length) {
      await supersedeMemoryFacts(conflictingIds);
    }
    await addUserMemoryFacts(
      [{ text: body, importance: "important", confidence: 1 }],
      "manual",
    );
  }
}

export async function resolveAriInboxItem(
  id: string,
  action: "keep" | "edit" | "dismiss" | "later",
  editedBody?: string,
): Promise<void> {
  const memoryItems = loadMemoryInbox();
  const memoryIndex = memoryItems.findIndex((item) => item.id === id);
  if (memoryIndex >= 0) {
    const item = memoryItems[memoryIndex];
    if (action === "dismiss") {
      memoryItems[memoryIndex] = { ...item, status: "dismissed" };
      saveMemoryInbox(memoryItems);
      return;
    }
    if (action === "later") {
      memoryItems[memoryIndex] = { ...item, status: "later" };
      saveMemoryInbox(memoryItems);
      return;
    }
    const body = (editedBody ?? item.body).trim();
    if (!body) {
      memoryItems[memoryIndex] = { ...item, status: "dismissed" };
      saveMemoryInbox(memoryItems);
      return;
    }
    await promoteMemoryInboxItem(item, body);
    memoryItems[memoryIndex] = {
      ...item,
      body,
      status: action === "edit" ? "edited" : "kept",
    };
    saveMemoryInbox(memoryItems);
    return;
  }

  if (action === "dismiss") {
    dismissTask(id);
    return;
  }
  if (action === "later") {
    confirmProposedTask(id);
    snoozeTask(id, 24 * 60 * 60_000);
    return;
  }
  const body = editedBody?.trim();
  confirmProposedTask(id, body ? { notes: body, title: body.slice(0, 120) } : {});
}
