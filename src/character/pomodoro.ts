import type { CharacterEmotion } from "../types/character";
import { appendTimelineEvent } from "../memory/activityTimeline";

export type PomodoroPhase = "idle" | "focus" | "break" | "paused";

export type PomodoroState = {
  phase: PomodoroPhase;
  focusMinutes: number;
  breakMinutes: number;
  phaseEndsAt?: number;
  startedAt?: number;
  completedFocusSessions: number;
  lastSupportAt?: number;
  pausedPhase?: "focus" | "break";
  pausedRemainingMs?: number;
};

const STORAGE_KEY = "desktop-character.pomodoro.v1";

const defaultState: PomodoroState = {
  phase: "idle",
  focusMinutes: 25,
  breakMinutes: 5,
  completedFocusSessions: 0,
};

let pomodoroCache: PomodoroState | null = null;

export function loadPomodoroState(): PomodoroState {
  if (pomodoroCache) {
    return { ...pomodoroCache };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      pomodoroCache = { ...defaultState };
      return { ...pomodoroCache };
    }
    const parsed = JSON.parse(raw) as Partial<PomodoroState>;
    pomodoroCache = {
      ...defaultState,
      ...parsed,
      phase: parsed.phase ?? "idle",
      completedFocusSessions: parsed.completedFocusSessions ?? 0,
    };
    return { ...pomodoroCache };
  } catch {
    pomodoroCache = { ...defaultState };
    return { ...pomodoroCache };
  }
}

function savePomodoroState(state: PomodoroState): void {
  pomodoroCache = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("ari-pomodoro-changed", { detail: state }));
}

export function startPomodoroFocus(
  focusMinutes = 25,
  breakMinutes = 5,
): PomodoroState {
  const now = Date.now();
  const previous = loadPomodoroState();
  const state: PomodoroState = {
    phase: "focus",
    focusMinutes,
    breakMinutes,
    startedAt: now,
    phaseEndsAt: now + focusMinutes * 60_000,
    completedFocusSessions: previous.completedFocusSessions,
    lastSupportAt: now,
  };
  savePomodoroState(state);
  appendTimelineEvent({
    kind: "pomodoro",
    summary: `Фокус ${focusMinutes} мин`,
  });
  return state;
}

export function pausePomodoro(): PomodoroState {
  const current = loadPomodoroState();
  if (current.phase !== "focus" && current.phase !== "break") return current;
  const remaining = current.phaseEndsAt
    ? Math.max(0, current.phaseEndsAt - Date.now())
    : 0;
  const state: PomodoroState = {
    ...current,
    phase: "paused",
    pausedPhase: current.phase,
    pausedRemainingMs: remaining,
    phaseEndsAt: undefined,
  };
  savePomodoroState(state);
  return state;
}

export function resumePomodoro(): PomodoroState {
  const current = loadPomodoroState();
  if (
    current.phase !== "paused" ||
    !current.pausedRemainingMs ||
    !current.pausedPhase
  ) {
    return current;
  }
  const now = Date.now();
  const state: PomodoroState = {
    ...current,
    phase: current.pausedPhase,
    phaseEndsAt: now + current.pausedRemainingMs,
    pausedPhase: undefined,
    pausedRemainingMs: undefined,
    startedAt: now,
  };
  savePomodoroState(state);
  return state;
}

export function stopPomodoro(): PomodoroState {
  const previous = loadPomodoroState();
  const state: PomodoroState = {
    ...defaultState,
    completedFocusSessions: previous.completedFocusSessions,
  };
  savePomodoroState(state);
  return state;
}

export function skipPomodoroPhase(): PomodoroState {
  const current = loadPomodoroState();
  if (current.phase === "focus") {
    return transitionToBreak(current);
  }
  if (current.phase === "break") {
    return transitionToFocus(current);
  }
  return current;
}

function transitionToBreak(state: PomodoroState): PomodoroState {
  const now = Date.now();
  const next: PomodoroState = {
    ...state,
    phase: "break",
    startedAt: now,
    phaseEndsAt: now + state.breakMinutes * 60_000,
    completedFocusSessions: state.completedFocusSessions + 1,
    lastSupportAt: now,
  };
  savePomodoroState(next);
  return next;
}

function transitionToFocus(state: PomodoroState): PomodoroState {
  const now = Date.now();
  const next: PomodoroState = {
    ...state,
    phase: "focus",
    startedAt: now,
    phaseEndsAt: now + state.focusMinutes * 60_000,
    lastSupportAt: now,
  };
  savePomodoroState(next);
  return next;
}

export type PomodoroTickResult =
  | { kind: "none"; state: PomodoroState }
  | { kind: "phase_ended"; nextPhase: PomodoroPhase; state: PomodoroState }
  | {
      kind: "support_moment";
      line: string;
      emotion: CharacterEmotion;
      state: PomodoroState;
    };

const SUPPORT_RECENT_KEY = "desktop-character.pomodoro-support-recent.v1";

const supportLines: Array<{ text: string; emotion: CharacterEmotion }> = [
  { text: "Ты всё ещё в фокусе. Я рядом, не отвлекаю.", emotion: "calm" },
  { text: "Нормальный темп. Продолжай, я не лезу.", emotion: "neutral" },
  { text: "Ещё немного — держишься хорошо.", emotion: "happy" },
  { text: "Если устал — можно сделать паузу. Я не буду давить.", emotion: "empathetic" },
  { text: "Тихо сижу рядом. Работай.", emotion: "calm" },
  { text: "Половина пути? Почти. Не сбивайся.", emotion: "curious" },
  { text: "Ещё чуть-чуть — я тут, если понадобится.", emotion: "shy" },
  { text: "Ритм нормальный. Не торопись ради галочки.", emotion: "pensive" },
];

function pickSupportLine(): { text: string; emotion: CharacterEmotion } {
  let recent: string[] = [];
  try {
    recent = JSON.parse(localStorage.getItem(SUPPORT_RECENT_KEY) ?? "[]") as string[];
  } catch {
    recent = [];
  }
  let pool = supportLines.filter(({ text }) => !recent.includes(text));
  if (!pool.length) {
    pool = supportLines;
    recent = [];
  }
  const line = pool[Math.floor(Math.random() * pool.length)];
  localStorage.setItem(
    SUPPORT_RECENT_KEY,
    JSON.stringify([line.text, ...recent.filter((text) => text !== line.text)].slice(0, 4)),
  );
  return line;
}

export function tickPomodoro(now = Date.now()): PomodoroTickResult {
  const state = loadPomodoroState();
  if (state.phase !== "focus" && state.phase !== "break") {
    return { kind: "none", state };
  }

  if (state.phaseEndsAt && now >= state.phaseEndsAt) {
    if (state.phase === "focus") {
      transitionToBreak(state);
      return { kind: "phase_ended", nextPhase: "break", state: loadPomodoroState() };
    }
    transitionToFocus(state);
    return { kind: "phase_ended", nextPhase: "focus", state: loadPomodoroState() };
  }

  if (state.phase !== "focus") {
    return { kind: "none", state };
  }

  const supportIntervalMs = 10 * 60_000;
  const lastSupport = state.lastSupportAt ?? state.startedAt ?? now;
  if (now - lastSupport < supportIntervalMs) {
    return { kind: "none", state };
  }

  const line = pickSupportLine();
  savePomodoroState({ ...state, lastSupportAt: now });
  return {
    kind: "support_moment",
    line: line.text,
    emotion: line.emotion,
    state: loadPomodoroState(),
  };
}

export function formatPomodoroRemaining(state: PomodoroState, now = Date.now()): string {
  if (!state.phaseEndsAt || state.phase === "idle" || state.phase === "paused") {
    return "";
  }
  const seconds = Math.max(0, Math.ceil((state.phaseEndsAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
