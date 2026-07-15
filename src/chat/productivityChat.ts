import type { AppSettings } from "../settings/appSettings";
import type { CharacterEmotion } from "../types/character";
import type { CharacterMood } from "../character/mood";
import { wrapCommandReply } from "./commandCharacterWrap";
import { ensureGoalForFocus } from "../tasks/goalLedger";
import { startProductivityFocus } from "../character/productivitySession";
import { endFocusSession } from "../character/focusSession";
import {
  pausePomodoro,
  resumePomodoro,
  stopPomodoro,
} from "../character/pomodoro";

type ProductivityOutcome =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      command: string;
      emotion: CharacterEmotion;
    };

function handled(command: string, body: string): ProductivityOutcome {
  const wrapped = wrapCommandReply(command, body);
  return {
    handled: true,
    command,
    reply: wrapped.reply,
    emotion: wrapped.emotion,
  };
}

export function parsePomodoroStartRequest(
  raw: string,
  defaultMinutes: number,
): { goal: string; minutes: number } {
  const minMatch = raw.match(/(\d{1,3})\s*(?:мин(?:ут)?|min\b)/i);
  const minutes = minMatch
    ? Math.min(120, Math.max(5, Number(minMatch[1])))
    : defaultMinutes;

  let goal = raw
    .replace(
      /^(?:запусти|начни|стартуй|включи|поставь)\s+(?:помодоро|таймер(?:\s+фокуса)?)/i,
      "",
    )
    .replace(/^помодоро/i, "")
    .replace(/(\d{1,3})\s*(?:мин(?:ут)?|min\b)/gi, "")
    .replace(/(?:^|\s)(?:на|про|для)\s+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!goal) {
    goal = "Фокус-сессия";
  }

  return { goal, minutes };
}

export function tryHandleProductivityChatCommand(
  rawInput: string,
  settings: AppSettings,
  _mood?: CharacterMood,
): ProductivityOutcome {
  const input = rawInput.trim();
  const lower = input.toLowerCase().replace(/\s+/g, " ");
  if (!input) {
    return { handled: false };
  }

  if (
    /^(?:запусти|начни|стартуй|включи|поставь)\s+(?:помодоро|таймер)/i.test(
      lower,
    ) ||
    /^помодоро(?:\s+на|\s+для|\s+про|:|\s+\d)/i.test(lower)
  ) {
    if (!settings.pomodoroEnabled) {
      return handled(
        "pomodoro-start",
        "Помодоро выключено в настройках — включи 🍅, и запущу.",
      );
    }
    const { goal, minutes } = parsePomodoroStartRequest(
      input,
      settings.pomodoroFocusMinutes,
    );
    const linkedGoal = ensureGoalForFocus(goal);
    startProductivityFocus({
      goal,
      plannedMinutes: minutes,
      breakMinutes: settings.pomodoroBreakMinutes,
    });
    return handled(
      "pomodoro-start",
      `Помодоро на ${minutes} мин: «${goal}». Цель: «${linkedGoal.title}». Могу тихо подстраховать, пока ты в фокусе.`,
    );
  }

  if (
    /^(?:стоп|останови|выключи|заверш(?:и|ить))\s+помодоро/i.test(lower) ||
    /^стоп\s+таймер/i.test(lower)
  ) {
    endFocusSession("completed");
    stopPomodoro();
    return handled("pomodoro-stop", "Помодоро остановлен. Фокус-сессия закрыта.");
  }

  if (/^(?:пауза|приостанови)\s+помодоро/i.test(lower)) {
    pausePomodoro();
    return handled("pomodoro-pause", "Помодоро на паузе. Скажи «продолжи помодоро», когда вернёшься.");
  }

  if (/^(?:продолжи|возобнови)\s+помодоро/i.test(lower)) {
    resumePomodoro();
    return handled("pomodoro-resume", "Продолжаю помодоро.");
  }

  return { handled: false };
}
