import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateToTaskStore } from "../src/tasks/taskMigration";
import { invalidateTaskCache, loadTasks } from "../src/tasks/taskStore";

const MIGRATION_KEY = "desktop-character.tasks-migrated.v1";

function setupStorage(seed: Record<string, string> = {}): Map<string, string> {
  const storage = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = {
        onerror: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        result: {
          objectStoreNames: { contains: () => false },
          close: () => {},
        },
      };
      queueMicrotask(() => {
        request.onsuccess?.call(request);
      });
      return request;
    },
  });
  return storage;
}

describe("taskMigration", () => {
  beforeEach(() => {
    setupStorage();
    invalidateTaskCache();
  });

  it("migrates backlog items into unified tasks once", async () => {
    setupStorage({
      "desktop-character.ari-backlog.v1": JSON.stringify([
        {
          id: "backlog-1",
          title: "Write tests",
          status: "open",
          priority: "high",
          category: "testing",
          createdAt: 1,
          updatedAt: 2,
        },
      ]),
    });
    invalidateTaskCache();

    await migrateToTaskStore();
    const tasks = loadTasks({ includeDone: true });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Write tests");
    expect(tasks[0]?.priority).toBe("high");
    expect(localStorage.getItem(MIGRATION_KEY)).toBe("1");

    await migrateToTaskStore();
    expect(loadTasks({ includeDone: true })).toHaveLength(1);
  });

  it("maps inbox task kinds to proposed tasks and skips memory items", async () => {
    setupStorage({
      "desktop-character.ari-inbox.v1": JSON.stringify([
        {
          id: "inbox-1",
          kind: "suggested_task",
          title: "Call dentist",
          body: "Schedule checkup",
          confidence: 0.8,
          reason: "extracted",
          proposedAt: 10,
          status: "pending",
        },
        {
          id: "inbox-2",
          kind: "memory",
          title: "Likes tea",
          body: "User prefers green tea",
          confidence: 0.9,
          reason: "memory",
          proposedAt: 11,
          status: "pending",
        },
      ]),
    });
    invalidateTaskCache();

    await migrateToTaskStore();
    const tasks = loadTasks({ includeDone: true });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("proposed");
    expect(tasks[0]?.title).toBe("Call dentist");
  });
});
