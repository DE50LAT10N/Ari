import { afterEach, describe, expect, it } from "vitest";
import {
  drainProactiveRequests,
  enqueueProactiveRequest,
  resetProactiveBridgeForTests,
  subscribeProactiveRequests,
} from "../src/character/proactiveBridge";

describe("proactiveBridge", () => {
  afterEach(() => {
    resetProactiveBridgeForTests();
  });

  it("enqueues and drains requests in order", () => {
    enqueueProactiveRequest({
      kind: "context_comment",
      eventHint: "first",
    });
    enqueueProactiveRequest({
      kind: "check_in",
      eventHint: "second",
    });
    const drained = drainProactiveRequests();
    expect(drained).toHaveLength(2);
    expect(drained[0]?.eventHint).toBe("first");
    expect(drained[1]?.kind).toBe("check_in");
    expect(drainProactiveRequests()).toEqual([]);
  });

  it("notifies subscribers on enqueue", () => {
    let calls = 0;
    const unsub = subscribeProactiveRequests(() => {
      calls += 1;
    });
    enqueueProactiveRequest({
      kind: "return_reaction",
      eventHint: "снова здесь",
    });
    expect(calls).toBe(1);
    unsub();
  });

  it("deduplicates equivalent pending requests", () => {
    const firstId = enqueueProactiveRequest({
      kind: "context_comment",
      eventHint: "same event",
    });
    const duplicateId = enqueueProactiveRequest({
      kind: "context_comment",
      eventHint: " same event ",
    });

    expect(duplicateId).toBe(firstId);
    expect(drainProactiveRequests()).toHaveLength(1);
  });

  it("keeps requests with distinct context", () => {
    enqueueProactiveRequest({
      kind: "context_comment",
      eventHint: "same event",
      scenario: "build_failed",
    });
    enqueueProactiveRequest({
      kind: "context_comment",
      eventHint: "same event",
      scenario: "build_succeeded",
    });

    expect(drainProactiveRequests()).toHaveLength(2);
  });

  it("bounds the pending queue and keeps the newest requests", () => {
    for (let index = 0; index < 40; index += 1) {
      enqueueProactiveRequest({
        kind: "context_comment",
        eventHint: `event ${index}`,
      });
    }

    const drained = drainProactiveRequests();
    expect(drained).toHaveLength(32);
    expect(drained[0]?.eventHint).toBe("event 8");
    expect(drained.at(-1)?.eventHint).toBe("event 39");
  });
});
