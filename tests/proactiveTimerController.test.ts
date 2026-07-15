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

  it("does not overlap async timer tasks", async () => {
    const callbacks: Array<() => void> = [];
    let release: () => void = () => undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const timer = createProactiveTimerController(
      { intervalMs: 15_000, task },
      {
        setInterval: (callback) => {
          callbacks.push(callback);
          return callbacks.length;
        },
        clearInterval: vi.fn(),
      },
    );

    timer.start();
    callbacks[0]();
    callbacks[0]();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    callbacks[0]();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("releases the single-flight guard after a task failure", async () => {
    const callbacks: Array<() => void> = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const task = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const timer = createProactiveTimerController(
      { intervalMs: 15_000, task },
      {
        setInterval: (callback) => {
          callbacks.push(callback);
          return callbacks.length;
        },
        clearInterval: vi.fn(),
      },
    );

    timer.start();
    callbacks[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    callbacks[0]();
    await Promise.resolve();

    expect(task).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
