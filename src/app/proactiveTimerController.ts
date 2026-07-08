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

  const tick = () => {
    void current.task();
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
