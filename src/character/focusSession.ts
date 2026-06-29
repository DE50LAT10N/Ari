import { appendTimelineEvent } from "../memory/activityTimeline";
import { notifyNew } from "./notifications";

export type FocusInterruption = {
  at: number;
  durationSeconds: number;
};

export type FocusSessionResult = "completed" | "abandoned" | "extended";

export type FocusTask = {
  id: string;
  title: string;
  linkedLoopId?: string;
  status: "todo" | "doing" | "done";
  createdAt: number;
  completedAt?: number;
};

export type FocusSession = {
  id: string;
  goal: string;
  successCriteria?: string;
  forbiddenApps?: string[];
  startedAt: number;
  endedAt?: number;
  plannedMinutes: number;
  breakMinutes: number;
  bodyDoubling: boolean;
  interruptions: FocusInterruption[];
  result?: FocusSessionResult;
  recap?: string;
  linkedLoopId?: string;
  currentStep?: string;
  blockers?: string[];
  completed?: string[];
  relatedThreads?: string[];
  tasks?: FocusTask[];
};

const STORAGE_KEY = "desktop-character.focus-sessions.v2";
const ACTIVE_KEY = "desktop-character.active-focus-session.v1";
const LEGACY_WORK_KEY = "desktop-character.work-sessions.v1";
const MAX_SESSIONS = 50;
let legacyWorkMigrated = false;
let sessionsCache: FocusSession[] | null = null;

function getActiveFocusSessionInternal(): FocusSession | null {
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (!activeId) return null;
  return loadAllSessions().find((session) => session.id === activeId) ?? null;
}

function migrateLegacyWorkSessions(): void {
  if (legacyWorkMigrated) return;
  legacyWorkMigrated = true;
  try {
    const raw = localStorage.getItem(LEGACY_WORK_KEY);
    if (!raw) return;
    const sessions = JSON.parse(raw);
    const active = Array.isArray(sessions)
      ? sessions.find((session) => !session.endedAt)
      : null;
    if (!active) {
      localStorage.removeItem(LEGACY_WORK_KEY);
      return;
    }
    const current = getActiveFocusSessionInternal();
    if (current && !current.endedAt) {
      patchFocusSession(current.id, {
        currentStep: active.currentStep,
        blockers: active.blockers ?? [],
        completed: active.completed ?? [],
        relatedThreads: active.relatedThreads ?? [],
        tasks: (active.tasks ?? []).map(
          (task: { id: string; title: string; linkedLoopId?: string; status: FocusTask["status"]; createdAt: number; completedAt?: number }) => ({
            id: task.id,
            title: task.title,
            linkedLoopId: task.linkedLoopId,
            status: task.status,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
          }),
        ),
        goal: current.goal || active.goal || active.title || current.goal,
      });
    }
    localStorage.removeItem(LEGACY_WORK_KEY);
  } catch {
    localStorage.removeItem(LEGACY_WORK_KEY);
  }
}

function patchFocusSession(
  sessionId: string,
  patch: Partial<
    Pick<
      FocusSession,
      | "goal"
      | "currentStep"
      | "blockers"
      | "completed"
      | "relatedThreads"
      | "tasks"
      | "recap"
      | "linkedLoopId"
    >
  >,
  options?: { notifyFocusChanged?: boolean },
): FocusSession | null {
  const sessions = loadAllSessions();
  const index = sessions.findIndex(({ id }) => id === sessionId);
  if (index < 0) return null;
  sessions[index] = { ...sessions[index], ...patch };
  saveAllSessions(sessions);
  if (options?.notifyFocusChanged) {
    window.dispatchEvent(new CustomEvent("ari-focus-session-changed"));
  }
  return sessions[index];
}

function loadAllSessions(): FocusSession[] {
  if (sessionsCache) {
    return sessionsCache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      sessionsCache = [];
      return sessionsCache;
    }
    const parsed = JSON.parse(raw);
    sessionsCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    sessionsCache = [];
  }
  return sessionsCache;
}

function saveAllSessions(sessions: FocusSession[]): void {
  const trimmed = sessions.slice(0, MAX_SESSIONS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  sessionsCache = trimmed;
}

function saveActiveId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
  window.dispatchEvent(new CustomEvent("ari-focus-session-changed"));
}

export function loadFocusSessions(): FocusSession[] {
  return loadAllSessions();
}

export function importFocusSessions(sessions: FocusSession[]): void {
  if (!sessions.length) return;
  saveAllSessions(sessions);
}

export function getActiveFocusSession(): FocusSession | null {
  migrateLegacyWorkSessions();
  return getActiveFocusSessionInternal();
}

export function isFocusSessionActive(): boolean {
  const session = getActiveFocusSession();
  return Boolean(session && !session.endedAt);
}

export type StartFocusSessionInput = {
  goal: string;
  successCriteria?: string;
  forbiddenApps?: string[];
  plannedMinutes: number;
  breakMinutes: number;
  bodyDoubling?: boolean;
};

export function startFocusSession(input: StartFocusSessionInput): FocusSession {
  const active = getActiveFocusSession();
  if (active && !active.endedAt) {
    endFocusSession("abandoned");
  }

  const session: FocusSession = {
    id: crypto.randomUUID(),
    goal: input.goal.trim().slice(0, 500),
    successCriteria: input.successCriteria?.trim().slice(0, 500),
    forbiddenApps: input.forbiddenApps
      ?.map((app) => app.trim())
      .filter(Boolean)
      .slice(0, 12),
    startedAt: Date.now(),
    plannedMinutes: input.plannedMinutes,
    breakMinutes: input.breakMinutes,
    bodyDoubling: input.bodyDoubling ?? false,
    interruptions: [],
  };

  const sessions = loadAllSessions();
  sessions.unshift(session);
  saveAllSessions(sessions);
  saveActiveId(session.id);
  appendTimelineEvent({
    kind: "focus",
    summary: session.goal,
    payloadRef: session.id,
  });
  return session;
}

export function recordInterruption(durationSeconds: number): void {
  const session = getActiveFocusSession();
  if (!session || session.endedAt) return;

  const updated: FocusSession = {
    ...session,
    interruptions: [
      ...session.interruptions,
      { at: Date.now(), durationSeconds: Math.max(0, durationSeconds) },
    ],
  };
  const sessions = loadAllSessions();
  const index = sessions.findIndex(({ id }) => id === session.id);
  if (index >= 0) {
    sessions[index] = updated;
    saveAllSessions(sessions);
    saveActiveId(session.id);
  }
}

export function endFocusSession(
  result: FocusSessionResult,
  recap?: string,
  linkedLoopId?: string,
): FocusSession | null {
  const session = getActiveFocusSession();
  if (!session || session.endedAt) return null;

  const ended: FocusSession = {
    ...session,
    endedAt: Date.now(),
    result,
    recap: recap?.trim().slice(0, 2000),
    linkedLoopId,
  };

  const sessions = loadAllSessions();
  const index = sessions.findIndex(({ id }) => id === session.id);
  if (index >= 0) {
    sessions[index] = ended;
    saveAllSessions(sessions);
  }
  saveActiveId(null);
  window.dispatchEvent(
    new CustomEvent("ari-focus-session-ended", { detail: ended }),
  );
  appendTimelineEvent({
    kind: "focus",
    summary: `Завершено: ${ended.goal} (${result})`,
    payloadRef: ended.id,
  });
  return ended;
}

export function countFocusSessionsToday(now = Date.now()): number {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();

  return loadAllSessions().filter(
    (session) =>
      session.endedAt &&
      session.endedAt >= dayStart &&
      session.result === "completed",
  ).length;
}

export function getFocusSessionDurationMinutes(session: FocusSession): number {
  const end = session.endedAt ?? Date.now();
  return Math.round((end - session.startedAt) / 60_000);
}

export function updateActiveFocusStep(step: string): FocusSession | null {
  const session = getActiveFocusSession();
  if (!session || session.endedAt) return null;
  return patchFocusSession(session.id, {
    currentStep: step.trim().slice(0, 500),
  });
}

export function addActiveFocusTask(
  title: string,
  linkedLoopId?: string,
): FocusTask | null {
  const session = getActiveFocusSession();
  if (!session || session.endedAt) return null;
  const task: FocusTask = {
    id: crypto.randomUUID(),
    title: title.trim().slice(0, 200),
    linkedLoopId,
    status: "todo",
    createdAt: Date.now(),
  };
  patchFocusSession(session.id, {
    tasks: [task, ...(session.tasks ?? [])],
  }, { notifyFocusChanged: true });
  notifyNew("focus_task", task.title);
  return task;
}

export function updateActiveFocusBlockers(blockers: string[]): FocusSession | null {
  const session = getActiveFocusSession();
  if (!session || session.endedAt) return null;
  return patchFocusSession(session.id, {
    blockers: blockers
      .map((blocker) => blocker.trim())
      .filter(Boolean)
      .slice(0, 12),
  });
}

export function addActiveFocusBlocker(blocker: string): FocusSession | null {
  const session = getActiveFocusSession();
  if (!session || session.endedAt) return null;
  const next = [
    blocker.trim(),
    ...(session.blockers ?? []).filter(
      (entry) => entry.toLowerCase() !== blocker.trim().toLowerCase(),
    ),
  ].slice(0, 12);
  return patchFocusSession(session.id, { blockers: next });
}

export function describeActiveFocusSession(
  session: FocusSession | null,
): string {
  if (!session || session.endedAt) {
    return "нет активной фокус-сессии";
  }
  return [
    `Цель: ${session.goal}.`,
    session.currentStep ? `Текущий шаг: ${session.currentStep}.` : "",
    session.blockers?.length
      ? `Блокеры: ${session.blockers.join("; ")}.`
      : "",
    session.completed?.length
      ? `Завершено: ${session.completed.join("; ")}.`
      : "",
    (session.tasks ?? []).filter((task) => task.status !== "done").length
      ? `Задачи: ${(session.tasks ?? [])
          .filter((task) => task.status !== "done")
          .map((task) => task.title)
          .join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
