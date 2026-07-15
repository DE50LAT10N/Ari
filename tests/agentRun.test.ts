import { describe, expect, it } from "vitest";
import {
  AgentRunCancelledError,
  AgentRunCoordinator,
} from "../src/core/agentRun";

describe("AgentRunCoordinator", () => {
  it("cancels the previous run and rejects stale continuations", () => {
    const coordinator = new AgentRunCoordinator();
    const first = coordinator.start("reply");
    const second = coordinator.start("mentor");

    expect(first.signal.aborted).toBe(true);
    expect(first.phase).toBe("cancelled");
    expect(coordinator.isCurrent(second.id)).toBe(true);
    expect(() => coordinator.assertCurrent(first.id)).toThrow(
      AgentRunCancelledError,
    );
  });

  it("only finishes the matching current run", () => {
    const coordinator = new AgentRunCoordinator();
    const run = coordinator.start("reply");

    coordinator.finish("stale", "completed");
    expect(coordinator.current?.id).toBe(run.id);

    coordinator.finish(run.id, "completed");
    expect(coordinator.current).toBeNull();
  });
});
