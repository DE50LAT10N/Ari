import type { AriBacklogItem } from "../character/ariBacklog";
import type { AriInboxItem } from "../memory/ariInbox";
import type { DecisionRecord } from "../memory/decisionRecords";
import type { OpenLoop } from "../memory/episodicMemory";
import { loadJsonArray } from "../platform/jsonStorage";
import {
  addTask,
  loadTasks,
  type Task,
  type TaskCategory,
  type TaskKind,
  type TaskPriority,
} from "./taskStore";

const MIGRATION_KEY = "desktop-character.tasks-migrated.v1";
const BACKLOG_KEY = "desktop-character.ari-backlog.v1";
const INBOX_KEY = "desktop-character.ari-inbox.v1";
const DECISION_KEY = "desktop-character.decision-records.v1";

const TASK_KINDS = new Set<TaskKind>(["task", "thread", "reminder", "decision"]);

function inboxKindToTaskKind(kind: AriInboxItem["kind"]): TaskKind {
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

function backlogCategory(cat: AriBacklogItem["category"]): TaskCategory {
  return cat;
}

function backlogPriority(p: AriBacklogItem["priority"]): TaskPriority {
  return p;
}

async function loadLegacyOpenLoops(): Promise<OpenLoop[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ari-episodes", 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("open-loops")) {
        database.createObjectStore("open-loops", { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("open-loops")) {
        database.close();
        resolve([]);
        return;
      }
      const tx = database.transaction("open-loops", "readonly");
      const storeRequest = tx.objectStore("open-loops").getAll();
      storeRequest.onsuccess = () => {
        database.close();
        resolve((storeRequest.result as OpenLoop[]) ?? []);
      };
      storeRequest.onerror = () => {
        database.close();
        reject(storeRequest.error);
      };
    };
  });
}

function taskExists(id: string): boolean {
  return loadTasks({ includeDone: true }).some((task) => task.id === id);
}

export async function migrateToTaskStore(): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY) === "1") {
    return;
  }
  if (loadTasks({ includeDone: true }).length > 0) {
    localStorage.setItem(MIGRATION_KEY, "1");
    return;
  }

  const migrated: Task[] = [];

  const backlog = loadJsonArray<AriBacklogItem>(BACKLOG_KEY);
  for (const item of backlog) {
    if (taskExists(item.id)) continue;
    migrated.push({
      id: item.id,
      title: item.title,
      notes: item.notes,
      kind: item.dueAt ? "reminder" : "task",
      status: item.status === "done" ? "done" : "open",
      priority: backlogPriority(item.priority),
      category: backlogCategory(item.category),
      projectId: item.projectId,
      dueAt: item.dueAt,
      reminderState: item.dueAt ? "scheduled" : undefined,
      snoozeCount: item.status === "deferred" ? 1 : 0,
      source: "migrated",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      resolvedAt: item.status === "done" ? item.updatedAt : undefined,
    });
  }

  const inbox = loadJsonArray<AriInboxItem>(INBOX_KEY);
  for (const item of inbox) {
    if (item.kind === "memory" || item.kind === "memory_conflict") {
      continue;
    }
    if (taskExists(item.id)) continue;
    const status =
      item.status === "pending" || item.status === "later"
        ? "proposed"
        : item.status === "dismissed"
          ? "dismissed"
          : "open";
    migrated.push({
      id: item.id,
      title: item.title,
      notes: item.body,
      kind: inboxKindToTaskKind(item.kind),
      status,
      priority: "normal",
      category:
        item.kind === "failed_action"
          ? "bug"
          : item.kind === "ask_later"
            ? "research"
            : "general",
      projectId: item.projectId,
      dueAt: item.metadata?.dueAt ? Number(item.metadata.dueAt) : undefined,
      reminderState: item.metadata?.dueAt ? "scheduled" : undefined,
      source: status === "proposed" ? "proposed" : "migrated",
      inboxKind: item.kind,
      confidence: item.confidence,
      reason: item.reason,
      sourceMessage: item.sourceMessage,
      metadata: item.metadata,
      createdAt: item.proposedAt,
      updatedAt: item.proposedAt,
    });
  }

  try {
    const loops = await loadLegacyOpenLoops();
    for (const loop of loops) {
      if (taskExists(loop.id)) continue;
      migrated.push({
        id: loop.id,
        title: loop.text.slice(0, 300),
        notes: loop.text.length > 300 ? loop.text : undefined,
        kind: loop.dueAt ? "reminder" : "thread",
        status: loop.status === "resolved" ? "done" : "open",
        priority: "normal",
        dueAt: loop.dueAt,
        reminderState: loop.reminderState,
        snoozeCount: loop.snoozeCount ?? 0,
        lastRemindedAt: loop.lastRemindedAt,
        source: "migrated",
        createdAt: loop.createdAt,
        updatedAt: loop.updatedAt,
        resolvedAt: loop.resolvedAt,
      });
    }
  } catch {
    // ignore IDB errors during migration
  }

  const decisions = loadJsonArray<DecisionRecord>(DECISION_KEY);
  for (const record of decisions) {
    if (taskExists(record.id)) continue;
    migrated.push({
      id: record.id,
      title: record.title,
      notes: [record.context, record.decision, ...record.alternatives]
        .filter(Boolean)
        .join("\n"),
      kind: "decision",
      status: record.status === "open" ? "open" : "done",
      priority: "normal",
      projectId: record.projectId,
      source: "migrated",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      resolvedAt: record.decidedAt,
    });
  }

  for (const task of migrated) {
    if (!TASK_KINDS.has(task.kind)) continue;
    addTask(task);
  }

  localStorage.setItem(MIGRATION_KEY, "1");
}
