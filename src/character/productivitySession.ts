import {
  startFocusSession,
  type FocusSession,
  type StartFocusSessionInput,
} from "./focusSession";
import { startPomodoroFocus } from "./pomodoro";

/** Starts focus session and pomodoro focus phase together (distraction nudge expects both). */
export function startProductivityFocus(
  input: StartFocusSessionInput,
): FocusSession {
  const session = startFocusSession(input);
  startPomodoroFocus(input.plannedMinutes, input.breakMinutes);
  return session;
}
