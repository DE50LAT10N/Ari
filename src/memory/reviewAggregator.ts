import { loadTimelineForDay, loadTimelineEvents } from "./activityTimeline";
import { loadDecisionRecords } from "./decisionRecords";
import { getNextTask, loadTasks } from "../tasks/taskStore";
import { getActiveFocusSession, countFocusSessionsToday } from "../character/focusSession";
import { dayKey } from "../character/datetime";

export type DailyReview = {
  date: string;
  done: string[];
  stuck: string[];
  carry: string[];
  decisions: string[];
  nextStep: string;
  highlights: string[];
};

export type WeeklyReview = {
  weekStart: string;
  themes: string[];
  blockers: string[];
  focusWindows: string[];
  reminderNoise: string[];
  staleItems: string[];
};

function weekStartKey(date = new Date()): string {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy.toISOString().slice(0, 10);
}

export function buildDailyReview(date = new Date()): DailyReview {
  const key = dayKey(date);
  const events = loadTimelineForDay(key);
  const focus = getActiveFocusSession();
  const done = events
    .filter((event) => event.kind === "focus" || event.kind === "pomodoro")
    .map((event) => event.summary)
    .slice(0, 8);
  const stuck = focus?.blockers?.slice(0, 5) ?? [];
  const carry =
    focus?.tasks
      ?.filter((task) => task.status !== "done")
      .map((task) => task.title)
      .slice(0, 6) ?? [];
  const decisions = loadDecisionRecords()
    .filter((record) => record.decidedAt && dayKey(new Date(record.decidedAt)) === key)
    .map((record) => `${record.title}: ${record.decision ?? "—"}`)
    .slice(0, 5);
  const nextItem = getNextTask();
  const highlights = events.slice(0, 6).map((event) => `[${event.kind}] ${event.summary}`);

  return {
    date: key,
    done: done.length ? done : [`Фокус-сессий сегодня: ${countFocusSessionsToday()}`],
    stuck,
    carry,
    decisions,
    nextStep: nextItem?.title ?? "Следующий шаг не выбран.",
    highlights,
  };
}

export function buildWeeklyReview(date = new Date()): WeeklyReview {
  const startKey = weekStartKey(date);
  const startMs = new Date(`${startKey}T00:00:00`).getTime();
  const events = loadTimelineEvents(startMs, 300);
  const kindCounts = new Map<string, number>();
  for (const event of events) {
    kindCounts.set(event.kind, (kindCounts.get(event.kind) ?? 0) + 1);
  }
  const themes = [...kindCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([kind, count]) => `${kind}: ${count}`);
  const blockers = getActiveFocusSession()?.blockers?.slice(0, 6) ?? [];
  const focusWindows = events
    .filter((event) => event.kind === "focus" || event.kind === "pomodoro")
    .map((event) => new Date(event.time).toLocaleString())
    .slice(0, 8);
  const reminderNoise = events
    .filter((event) => event.kind === "reminder")
    .map((event) => event.summary)
    .slice(0, 8);
  const staleItems = [
    ...loadTasks({ status: "proposed" }).map((task) => task.title),
    ...loadTasks({ status: "open" })
      .filter((task) => task.dueAt && task.dueAt > Date.now())
      .map((task) => task.title),
  ].slice(0, 10);

  return {
    weekStart: startKey,
    themes: themes.length ? themes : ["Неделя пока без явных тем."],
    blockers,
    focusWindows,
    reminderNoise,
    staleItems,
  };
}

export function formatDailyReview(review: DailyReview): string {
  return [
    `Обзор дня — ${review.date}`,
    "",
    "Сделано:",
    ...review.done.map((line) => `• ${line}`),
    "",
    "Застряло:",
    ...(review.stuck.length ? review.stuck.map((line) => `• ${line}`) : ["• пока ничего"]),
    "",
    "На потом:",
    ...(review.carry.length ? review.carry.map((line) => `• ${line}`) : ["• пока пусто"]),
    "",
    "Решения:",
    ...(review.decisions.length
      ? review.decisions.map((line) => `• ${line}`)
      : ["• не зафиксировано"]),
    "",
    `Следующий шаг: ${review.nextStep}`,
  ].join("\n");
}

export function formatWeeklyReview(review: WeeklyReview): string {
  return [
    `Неделя с ${review.weekStart}`,
    "",
    "Темы:",
    ...review.themes.map((line) => `• ${line}`),
    "",
    "Блокеры:",
    ...(review.blockers.length
      ? review.blockers.map((line) => `• ${line}`)
      : ["• пока нет"]),
    "",
    "Окна фокуса:",
    ...(review.focusWindows.length
      ? review.focusWindows.map((line) => `• ${line}`)
      : ["• не отмечено"]),
    "",
    "Напоминания:",
    ...(review.reminderNoise.length
      ? review.reminderNoise.map((line) => `• ${line}`)
      : ["• тихо"]),
    "",
    "Отложенное:",
    ...(review.staleItems.length
      ? review.staleItems.map((line) => `• ${line}`)
      : ["• всё актуально"]),
  ].join("\n");
}
