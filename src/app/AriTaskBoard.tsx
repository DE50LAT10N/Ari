import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeTaskWithGoalInference,
  addTask,
  loadTasks,
  getNextTask,
  getDueTasks,
  snoozeTask,
  countProposedTasks,
  countOpenTasks,
  TASKS_CHANGED_EVENT,
  type Task,
} from "../tasks/taskStore";
import {
  GOALS_CHANGED_EVENT,
  loadGoals,
  setCurrentGoal,
  type Goal,
} from "../tasks/goalLedger";
import { resolveAriInboxItem } from "../memory/ariInbox";
import { formatReminderTime } from "../character/reminders";
import {
  endFocusSession,
  getActiveFocusSession,
  updateActiveFocusStep,
  type FocusSession,
} from "../character/focusSession";
import { startProductivityFocus } from "../character/productivitySession";
import { loadSettings } from "../settings/appSettings";
import {
  loadPomodoroState,
  pausePomodoro,
  resumePomodoro,
  skipPomodoroPhase,
  stopPomodoro,
  type PomodoroState,
} from "../character/pomodoro";
import { PomodoroCountdown } from "./PomodoroCountdown";

type AriTaskBoardProps = {
  chatOpen: boolean;
  onSpeakAbout?: (text: string) => void;
};

export function AriTaskBoard({ chatOpen, onSpeakAbout }: AriTaskBoardProps) {
  const [expanded, setExpanded] = useState(false);
  const [entering, setEntering] = useState(false);
  const boardRef = useRef<HTMLElement>(null);
  const wasVisibleRef = useRef(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [proposed, setProposed] = useState<Task[]>([]);
  const [due, setDue] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [next, setNext] = useState<Task | null>(null);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [pomodoro, setPomodoro] = useState<PomodoroState>(loadPomodoroState());
  const [draft, setDraft] = useState("");
  const [stepDraft, setStepDraft] = useState("");

  const refresh = useCallback(() => {
    setTasks(loadTasks({ status: "open" }));
    setProposed(loadTasks({ status: "proposed" }));
    setDue(getDueTasks());
    setGoals(loadGoals().slice(0, 5));
    setNext(getNextTask());
    const session = getActiveFocusSession();
    setFocus(session);
    setStepDraft(session?.currentStep ?? "");
    setPomodoro(loadPomodoroState());
  }, []);

  useEffect(() => {
    refresh();
    const events = [
      TASKS_CHANGED_EVENT,
      GOALS_CHANGED_EVENT,
      "ari-pomodoro-changed",
      "ari-focus-session-changed",
      "ari-focus-session-ended",
      "ari-memory-inbox-changed",
    ];
    for (const name of events) {
      window.addEventListener(name, refresh);
    }
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      for (const name of events) {
        window.removeEventListener(name, refresh);
      }
      window.clearInterval(timer);
    };
  }, [refresh]);

  const badge = countProposedTasks() + countOpenTasks();
  const focusActive = Boolean(focus && !focus.endedAt);
  const showFocusPanel = focusActive || pomodoro.phase !== "idle";
  const visible = !chatOpen && (badge > 0 || showFocusPanel || goals.length > 0);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setEntering(true);
      const timer = window.setTimeout(() => setEntering(false), 450);
      wasVisibleRef.current = true;
      return () => window.clearTimeout(timer);
    }
    if (!visible) {
      wasVisibleRef.current = false;
    }
    return undefined;
  }, [visible]);

  useEffect(() => {
    const board = boardRef.current;
    const root = board?.closest(".desktop-character") as HTMLElement | null;
    if (!board || !root || !visible) {
      return undefined;
    }
    const syncHeight = () => {
      root.style.setProperty(
        "--ari-task-board-height",
        `${board.offsetHeight}px`,
      );
    };
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(board);
    return () => {
      observer.disconnect();
      root.style.setProperty("--ari-task-board-height", "0px");
    };
  }, [visible, expanded, badge, tasks.length, proposed.length, focus, pomodoro.phase]);

  if (chatOpen) {
    return null;
  }

  if (!visible) {
    return null;
  }

  const nowIds = new Set(
    (due[0] ? due : next ? [next] : []).slice(0, 2).map((task) => task.id),
  );
  const visibleOpen = tasks.filter((task) => !nowIds.has(task.id));
  const openLimit = expanded ? 12 : 4;

  const handleAdd = () => {
    const title = draft.trim();
    if (!title) return;
    addTask({
      title,
      kind: "task",
      status: "open",
      priority: "normal",
      source: "user",
    });
    setDraft("");
    refresh();
  };

  const nudgeAboutTask = (task: Task) => {
    onSpeakAbout?.(
      task.dueAt
        ? `Напоминание: «${task.title}» — ${formatReminderTime(task.dueAt)}`
        : `Следующее: «${task.title}»`,
    );
  };

  return (
    <aside
      ref={boardRef}
      className={`ari-task-board${expanded ? " expanded" : ""}${
        entering ? " ari-task-board--entering" : ""
      }`}
      aria-label="Задачи Ari"
    >
      <div className="ari-task-board-header">
        <span className="ari-task-board-title">Дела</span>
        {badge > 0 && (
          <span className="ari-task-board-badge">{badge > 9 ? "9+" : badge}</span>
        )}
        <button
          type="button"
          className="ari-task-board-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? "Свернуть панель дел" : "Развернуть панель дел"}
        >
          {expanded ? "▾" : "▸"}
        </button>
      </div>

      {(focusActive || pomodoro.phase !== "idle") && (
        <div className="ari-task-board-focus">
          {focusActive && (
            <>
              <div className="ari-task-board-focus-goal">
                {focus?.goal?.slice(0, 100) || "Фокус"}
              </div>
              <input
                className="ari-task-board-step-input"
                value={stepDraft}
                placeholder="Текущий шаг…"
                onChange={(event) => setStepDraft(event.currentTarget.value)}
                onBlur={() => {
                  if (stepDraft.trim()) updateActiveFocusStep(stepDraft.trim());
                }}
              />
            </>
          )}
          {pomodoro.phase !== "idle" && (
            <div className="ari-task-board-pomodoro">
              <PomodoroCountdown pomodoro={pomodoro} />
              <span className="ari-task-board-pomodoro-phase">
                {pomodoro.phase === "focus"
                  ? "фокус"
                  : pomodoro.phase === "break"
                    ? "перерыв"
                    : "пауза"}
              </span>
              <div className="ari-task-board-pomodoro-actions">
                {pomodoro.phase === "paused" ? (
                  <button
                    type="button"
                    aria-label="Продолжить помодоро"
                    onClick={() => resumePomodoro()}
                  >
                    ▶
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Пауза помодоро"
                    onClick={() => pausePomodoro()}
                  >
                    ⏸
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Следующая фаза помодоро"
                  onClick={() => skipPomodoroPhase()}
                >
                  ⏭
                </button>
                <button
                  type="button"
                  aria-label="Остановить помодоро"
                  onClick={() => stopPomodoro()}
                >
                  ⏹
                </button>
              </div>
            </div>
          )}
          {!focusActive && (
            <button
              type="button"
              className="ari-task-board-mini-btn"
              onClick={() => {
                const settings = loadSettings();
                startProductivityFocus({
                  goal: "Фокус",
                  plannedMinutes: settings.pomodoroFocusMinutes,
                  breakMinutes: settings.pomodoroBreakMinutes,
                });
                refresh();
              }}
            >
              Старт фокуса
            </button>
          )}
          {focusActive && (
            <button
              type="button"
              className="ari-task-board-mini-btn"
              onClick={() => {
                endFocusSession("completed");
                refresh();
              }}
            >
              Завершить
            </button>
          )}
        </div>
      )}

      {goals.length > 0 && (
        <div className="ari-task-board-goals">
          <div className="ari-task-board-section-label">Цели</div>
          {goals.slice(0, expanded ? 5 : 3).map((goal) => (
            <button
              key={goal.id}
              type="button"
              className={`ari-task-board-goal${goal.current ? " current" : ""}`}
              onClick={() => {
                setCurrentGoal(goal.id);
                onSpeakAbout?.(
                  `Текущая цель: «${goal.title}» — ${goal.progress}%.${
                    goal.lastFocus ? ` Последнее: ${goal.lastFocus}.` : ""
                  }`,
                );
                refresh();
              }}
              title="Сделать текущей целью"
            >
              <span className="ari-task-board-goal-title">
                {goal.current ? "→ " : ""}
                {goal.title}
              </span>
              <span className="ari-task-board-goal-percent">
                {goal.progress}%
              </span>
              <span className="ari-task-board-goal-track" aria-hidden="true">
                <span style={{ width: `${goal.progress}%` }} />
              </span>
              {goal.lastFocus && (
                <span className="ari-task-board-goal-focus">
                  {goal.lastFocus}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {(due[0] || next) && (
        <div className="ari-task-board-now">
          <div className="ari-task-board-section-label">Сейчас</div>
          {(due[0] ? due : next ? [next] : []).slice(0, 2).map((task) => (
            <div key={task.id} className="ari-task-board-item priority">
              <button
                type="button"
                className="ari-task-board-item-text"
                onClick={() => nudgeAboutTask(task)}
                title="Ari напомнит словами"
              >
                {task.title}
                {task.dueAt ? (
                  <span className="ari-task-board-due">
                    {formatReminderTime(task.dueAt)}
                  </span>
                ) : null}
              </button>
              <div className="ari-task-board-item-actions">
                <button
                  type="button"
                  aria-label={`Отметить выполненным: ${task.title}`}
                  onClick={() => {
                    void completeTaskWithGoalInference(task.id, loadSettings()).finally(
                      refresh,
                    );
                    refresh();
                  }}
                  title="Готово"
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label={`Отложить на 30 минут: ${task.title}`}
                  onClick={() => {
                    snoozeTask(task.id, 30 * 60_000);
                    refresh();
                  }}
                  title="Отложить 30 мин"
                >
                  ⏰
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {proposed.length > 0 && (
        <div className="ari-task-board-proposed">
          <div className="ari-task-board-section-label">Предложения</div>
          {proposed.slice(0, expanded ? 8 : 2).map((task) => (
            <div key={task.id} className="ari-task-board-item proposed">
              <span className="ari-task-board-item-text" title={task.title}>
                {task.title.length > 100
                  ? `${task.title.slice(0, 100)}…`
                  : task.title}
              </span>
              <div className="ari-task-board-item-actions">
                <button
                  type="button"
                  aria-label={`Принять предложение: ${task.title}`}
                  onClick={() => {
                    void resolveAriInboxItem(task.id, "keep");
                    refresh();
                  }}
                  title="Принять"
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label={`Отклонить предложение: ${task.title}`}
                  onClick={() => {
                    void resolveAriInboxItem(task.id, "dismiss");
                    refresh();
                  }}
                  title="Отклонить"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {visibleOpen.length > 0 && (
        <div className="ari-task-board-list">
          <div className="ari-task-board-section-label">
            {expanded ? "Все открытые" : "Открытые"}
          </div>
          {visibleOpen.slice(0, openLimit).map((task) => (
            <div key={task.id} className="ari-task-board-item">
              <button
                type="button"
                className="ari-task-board-item-text"
                onClick={() => nudgeAboutTask(task)}
                title="Ari напомнит словами"
              >
                {task.title}
              </button>
              <div className="ari-task-board-item-actions">
                <button
                  type="button"
                  aria-label={`Отметить выполненным: ${task.title}`}
                  onClick={() => {
                    void completeTaskWithGoalInference(task.id, loadSettings()).finally(
                      refresh,
                    );
                    refresh();
                  }}
                  title="Готово"
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label={`Отложить на 30 минут: ${task.title}`}
                  onClick={() => {
                    snoozeTask(task.id, 30 * 60_000);
                    refresh();
                  }}
                  title="Отложить 30 мин"
                >
                  ⏰
                </button>
              </div>
            </div>
          ))}
          {!expanded && visibleOpen.length > openLimit && (
            <button
              type="button"
              className="ari-task-board-mini-btn"
              onClick={() => setExpanded(true)}
            >
              Ещё {visibleOpen.length - openLimit}…
            </button>
          )}
        </div>
      )}

      <div className="ari-task-board-add">
        <input
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Добавить задачу…"
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAdd();
          }}
        />
        <button type="button" onClick={handleAdd} aria-label="Добавить задачу">
          +
        </button>
      </div>
    </aside>
  );
}
