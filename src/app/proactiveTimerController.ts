export type TimerApi = {
  setInterval: (callback: () => void, intervalMs: number) => number;
  clearInterval: (id: number) => void;
};

export type ProactiveTimerTask = () => void | Promise<void>;

export type ProactiveTimerController = {
  start: () => void;
  update: (input: { intervalMs: number; task: ProactiveTimerTask }) => void;
  stop: () => void;
  isRunning: () => boolean;
};

export function createProactiveTimerController(
  initial: { intervalMs: number; task: ProactiveTimerTask },
  timerApi: TimerApi = {
    setInterval: (callback, intervalMs) =>
      window.setInterval(callback, intervalMs),
    clearInterval: (id) => window.clearInterval(id),
  },
): ProactiveTimerController {
  let current = initial;
  let intervalId: number | null = null;
  let taskRunning = false;

  const tick = () => {
    if (taskRunning) {
      return;
    }
    taskRunning = true;
    let result: void | Promise<void>;
    try {
      result = current.task();
    } catch (error) {
      taskRunning = false;
      console.warn("Proactive timer task failed", error);
      return;
    }
    void Promise.resolve(result)
      .catch((error: unknown) => {
        console.warn("Proactive timer task failed", error);
      })
      .finally(() => {
        taskRunning = false;
      });
  };

  const stop = () => {
    if (intervalId === null) {
      return;
    }
    timerApi.clearInterval(intervalId);
    intervalId = null;
  };

  const start = () => {
    if (intervalId !== null) {
      return;
    }
    intervalId = timerApi.setInterval(tick, current.intervalMs);
  };

  return {
    start,
    update: (input) => {
      const intervalChanged = input.intervalMs !== current.intervalMs;
      current = input;
      if (intervalChanged && intervalId !== null) {
        stop();
        start();
      }
    },
    stop,
    isRunning: () => intervalId !== null,
  };
}
