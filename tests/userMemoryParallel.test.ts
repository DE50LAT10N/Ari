/**
 * Verifies parallel user-memory loads complete (no shared closed IDB handle).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

function createMockIndexedDB() {
  const databases = new Map<string, ReturnType<typeof makeDatabase>>();

  function makeDatabase() {
    const storeNames = new Set<string>();
    const stores = new Map<string, Map<string, unknown>>();

    const database = {
      objectStoreNames: {
        contains(name: string) {
          return storeNames.has(name);
        },
      },
      createObjectStore(name: string) {
        storeNames.add(name);
        stores.set(name, new Map());
        return {};
      },
      transaction(storeName: string, _mode: IDBTransactionMode) {
        const store = stores.get(storeName) ?? new Map();
        const tx = {
          objectStore() {
            return {
              getAll() {
                const request = {
                  result: [...store.values()],
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
              },
            };
          },
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
        };
        queueMicrotask(() => tx.oncomplete?.());
        return tx;
      },
      close() {
        // no-op
      },
    };

    return database;
  }

  return {
    open(_name: string, _version: number) {
      const request = {
        result: null as ReturnType<typeof makeDatabase> | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
        onblocked: null as (() => void) | null,
        error: null as Error | null,
      };

      queueMicrotask(() => {
        const database = makeDatabase();
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });

      return request;
    },
  };
}

describe("userMemory parallel load", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", createMockIndexedDB());
    vi.stubGlobal("localStorage", {
      getItem: () => "1",
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      dispatchEvent: () => true,
    });
    vi.stubGlobal("crypto", {
      randomUUID: () => "test-uuid",
    });
    vi.resetModules();
  });

  it("completes parallel loadUserMemory and loadUserMemorySummaries", async () => {
    const { loadUserMemory, loadUserMemorySummaries } = await import(
      "../src/memory/userMemory"
    );

    const [facts, summaries] = await Promise.all([
      loadUserMemory(),
      loadUserMemorySummaries(),
    ]);

    expect(facts).toEqual([]);
    expect(summaries).toEqual([]);
  });
});
