import { afterEach, describe, expect, it, vi } from "vitest";
import { delay, TimeoutError, withTimeout } from "../src/platform/asyncTimeout";

describe("asyncTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts callback-style operations when the deadline expires", async () => {
    vi.useFakeTimers();
    let operationSignal: AbortSignal | undefined;
    const result = withTimeout(
      (signal) => {
        operationSignal = signal;
        return new Promise<string>(() => undefined);
      },
      1_000,
      "test operation",
    );
    const rejection = expect(result).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(operationSignal?.aborted).toBe(true);
  });

  it("forwards an external abort signal", async () => {
    const controller = new AbortController();
    let operationSignal: AbortSignal | undefined;
    const result = withTimeout(
      (signal) => {
        operationSignal = signal;
        return new Promise<string>(() => undefined);
      },
      5_000,
      "test operation",
      { signal: controller.signal },
    );

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(operationSignal?.aborted).toBe(true);
  });

  it("cancels an abort-aware delay", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = delay(10_000, controller.signal);

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up its deadline after a synchronous operation failure", async () => {
    vi.useFakeTimers();

    await expect(
      withTimeout(
        () => {
          throw new Error("operation failed");
        },
        5_000,
        "test operation",
      ),
    ).rejects.toThrow("operation failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
