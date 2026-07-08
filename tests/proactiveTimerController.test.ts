import { describe, expect, it, vi } from "vitest";
import { createProactiveTimerController } from "../src/app/proactiveTimerController";

describe("proactive timer controller", () => {
  it("keeps one interval while updating to latest callback", () => {
    const callbacks: Array<() => void> = [];
    const clearInterval = vi.fn();
    const firstTask = vi.fn();
    const latestTask = vi.fn();
    const timer = createProactiveTimerController(
      { intervalMs: 15_000, task: firstTask },
      {
        setInterval: (callback) => {
          callbacks.push(callback);
          return callbacks.length;
        },
        clearInterval,
      },
    );

    timer.start();
    timer.update({ intervalMs: 15_000, task: latestTask });

    expect(callbacks).toHaveLength(1);
    expect(clearInterval).not.toHaveBeenCalled();

    callbacks[0]();
    expect(firstTask).not.toHaveBeenCalled();
    expect(latestTask).toHaveBeenCalledTimes(1);
  });

  it("restarts only when interval duration changes", () => {
    const callbacks: Array<() => void> = [];
    const clearInterval = vi.fn();
    const timer = createProactiveTimerController(
      { intervalMs: 15_000, task: vi.fn() },
      {
        setInterval: (callback) => {
          callbacks.push(callback);
          return callbacks.length;
        },
        clearInterval,
      },
    );

    timer.start();
    timer.update({ intervalMs: 30_000, task: vi.fn() });

    expect(callbacks).toHaveLength(2);
    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(timer.isRunning()).toBe(true);
  });
});
