import { dayKey as formatDayKey } from "../character/datetime";
import { loadJsonArray, saveJsonArray } from "../platform/jsonStorage";

export type TimelineEventKind =
  | "pomodoro"
  | "focus"
  | "memory"
  | "reminder"
  | "action"
  | "vision"
  | "window_switch"
  | "distraction"
  | "chat_command"
  | "review"
  | "backlog";

export type TimelineEvent = {
  id: string;
  kind: TimelineEventKind;
  time: number;
  summary: string;
  payloadRef?: string;
  projectId?: string;
};

const STORAGE_KEY = "desktop-character.activity-timeline.v1";
const MAX_EVENTS = 500;

function notify(): void {
  window.dispatchEvent(new Event("ari-timeline-changed"));
}

function loadAll(): TimelineEvent[] {
  return loadJsonArray<TimelineEvent>(STORAGE_KEY);
}

function saveAll(events: TimelineEvent[]): void {
  saveJsonArray(STORAGE_KEY, events, MAX_EVENTS);
  notify();
}

export function appendTimelineEvent(input: {
  kind: TimelineEventKind;
  summary: string;
  payloadRef?: string;
  projectId?: string;
  time?: number;
}): TimelineEvent {
  const event: TimelineEvent = {
    id: crypto.randomUUID(),
    kind: input.kind,
    time: input.time ?? Date.now(),
    summary: input.summary.trim().slice(0, 500),
    payloadRef: input.payloadRef,
    projectId: input.projectId,
  };
  const events = loadAll();
  events.unshift(event);
  saveAll(events);
  return event;
}

export function loadTimelineEvents(sinceMs?: number, limit = 80): TimelineEvent[] {
  const events = loadAll();
  const filtered = sinceMs
    ? events.filter((event) => event.time >= sinceMs)
    : events;
  return filtered.slice(0, limit);
}

export function loadTimelineForDay(dateKey?: string): TimelineEvent[] {
  const key = dateKey ?? formatDayKey();
  const start = new Date(`${key}T00:00:00`).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return loadAll().filter((event) => event.time >= start && event.time < end);
}
