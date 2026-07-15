import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDecisionRecord,
  decideDecisionRecord,
  loadDecisionRecords,
  supersedeDecisionRecord,
} from "../src/memory/decisionRecords";
import { invalidateTaskCache } from "../src/tasks/taskStore";

describe("decision records", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", new EventTarget());
    invalidateTaskCache();
  });

  it("round-trips context, alternatives and the final decision", () => {
    const created = createDecisionRecord({
      title: "Transport",
      context: "IDE bridge needs local authentication",
      alternatives: ["HTTP loopback", "named pipe"],
    });
    expect(loadDecisionRecords()[0].alternatives).toEqual([
      "HTTP loopback",
      "named pipe",
    ]);

    const decided = decideDecisionRecord(created.id, "Use authenticated loopback");
    expect(decided?.status).toBe("decided");
    expect(decided?.decision).toBe("Use authenticated loopback");
    expect(decided?.context).toBe("IDE bridge needs local authentication");
  });

  it("preserves a superseded decision as history", () => {
    const created = createDecisionRecord({ title: "Cache", context: "Pick TTL" });
    expect(supersedeDecisionRecord(created.id)?.status).toBe("superseded");
    expect(loadDecisionRecords()).toHaveLength(1);
  });
});
