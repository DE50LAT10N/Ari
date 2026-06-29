import { useEffect, useState } from "react";
import {
  formatPomodoroRemaining,
  type PomodoroState,
} from "../character/pomodoro";

type PomodoroCountdownProps = {
  pomodoro: PomodoroState;
};

export function PomodoroCountdown({ pomodoro }: PomodoroCountdownProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (pomodoro.phase === "idle" || pomodoro.phase === "paused") {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [pomodoro.phase]);

  void tick;
  const remaining = formatPomodoroRemaining(pomodoro);
  if (!remaining) {
    return null;
  }

  return <span className="pomodoro-remaining">{remaining}</span>;
}
