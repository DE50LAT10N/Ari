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

  it("does not create cooldown for a successful HTTP status", () => {
    recordGigaChatThrottle(200);
    const state = getGigaChatRateLimitState();
    expect(state.cooldownMs).toBe(0);
    expect(state.throttleFailures).toBe(0);
  });

  it("lets interactive chat overtake queued background work", async () => {
    const starts: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = enqueueGigaChatRequest(
      () =>
        new Promise<string>((resolve) => {
          starts.push("active background");
          releaseFirst = () => resolve("first done");
        }),
      undefined,
      { kind: "json", priority: "background" },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual(["active background"]);

    const background = enqueueGigaChatRequest(
      async () => {
        starts.push("queued background");
        return "background done";
      },
      undefined,
      { kind: "embedding", priority: "background" },
    );
    const interactive = enqueueGigaChatRequest(
      async () => {
        starts.push("interactive");
        return "interactive done";
      },
      undefined,
      { kind: "chat", priority: "interactive" },
    );

    releaseFirst();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(starts).toEqual(["active background", "interactive"]);
    await vi.advanceTimersByTimeAsync(2_500);

    expect(await first).toBe("first done");
    expect(await interactive).toBe("interactive done");
    expect(await background).toBe("background done");
    expect(starts).toEqual([
      "active background",
      "interactive",
      "queued background",
    ]);
  });

  it("cancels a queued request without allowing later work to overlap", async () => {
    const starts: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const first = enqueueGigaChatRequest(
      () =>
        new Promise<string>((resolve) => {
          starts.push("first");
          releaseFirst = () => resolve("first done");
        }),
    );
    const controller = new AbortController();
    const cancelled = enqueueGigaChatRequest(async () => {
      starts.push("cancelled");
      return "unexpected";
    }, controller.signal);
    const third = enqueueGigaChatRequest(async () => {
      starts.push("third");
      return "third done";
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toEqual(["first"]);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await first).toBe("first done");
    expect(await third).toBe("third done");
    expect(starts).toEqual(["first", "third"]);
  });
});
