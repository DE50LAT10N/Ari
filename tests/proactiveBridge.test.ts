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
});
