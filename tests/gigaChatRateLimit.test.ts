import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueGigaChatRequest,
  getGigaChatRateLimitState,
  recordGigaChatThrottle,
  resetGigaChatRateLimitForTests,
} from "../src/llm/gigaChatRateLimit";

describe("gigaChatRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGigaChatRateLimitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs GigaChat requests one at a time with a start gap", async () => {
    const starts: string[] = [];
    let releaseFirst: () => void = () => undefined;

    const first = enqueueGigaChatRequest(
      () =>
        new Promise<string>((resolve) => {
          starts.push("first");
          releaseFirst = () => resolve("first done");
        }),
    );
    const second = enqueueGigaChatRequest(async () => {
      starts.push("second");
      return "second done";
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual(["first"]);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(starts).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toBe("first done");
    expect(await second).toBe("second done");
    expect(starts).toEqual(["first", "second"]);
  });

  it("reports cooldown after throttling", () => {
    recordGigaChatThrottle(429);
    const state = getGigaChatRateLimitState();
    expect(state.cooldownMs).toBeGreaterThanOrEqual(29_000);
    expect(state.throttleFailures).toBe(1);
  });
});
