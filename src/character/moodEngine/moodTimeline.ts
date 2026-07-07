import { loadJsonArray, saveJsonArray } from "../../platform/jsonStorage";
import type { MoodClassificationResult } from "./moodClassifier";
import type { MoodEvent } from "./moodEvents";
import type { MoodUpdateResult } from "./moodUpdateEngine";
import type { MoodVector } from "./moodVector";

const MOOD_TIMELINE_KEY = "desktop-character.ari-mood-timeline.v1";
const MAX_MOOD_TIMELINE_ENTRIES = 40;

export type MoodTimelineEntry = {
  id: string;
  timestamp: number;
  eventTypes: string[];
  eventSources: string[];
  eventCount: number;
  strongestAxis: string | null;
  strongestDelta: number;
  delta: MoodVector;
  next: MoodVector;
  archetype: string;
  emotion: string;
  reason: string;
};

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value)
    ? value
    : fallback;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function vectorDelta(previous: MoodVector, next: MoodVector): MoodVector {
  const keys = unique([...Object.keys(previous), ...Object.keys(next)]);
  const delta: MoodVector = {};
  for (const key of keys) {
    delta[key] = finiteNumber(next[key]) - finiteNumber(previous[key]);
  }
  return delta;
}

function strongestDelta(delta: MoodVector): { axis: string | null; value: number } {
  let axis: string | null = null;
  let value = 0;
  for (const [key, raw] of Object.entries(delta)) {
    const current = finiteNumber(raw);
    if (Math.abs(current) > Math.abs(value)) {
      axis = key;
      value = current;
    }
  }
  return { axis, value };
}

function buildReason(input: {
  events: MoodEvent[];
  classification: MoodClassificationResult;
  strongestAxis: string | null;
  strongestDelta: number;
}): string {
  const types = unique(input.events.map((event) => event.type)).join(", ") || "decay";
  const sources = unique(input.events.map((event) => event.source)).join(", ") || "system";
  const axis = input.strongestAxis
    ? `${input.strongestAxis} ${input.strongestDelta >= 0 ? "+" : ""}${input.strongestDelta.toFixed(2)}`
    : "no visible delta";
  return `${sources}: ${types} -> ${axis}; ${input.classification.archetype}/${input.classification.emotion}`;
}

export function loadMoodTimeline(): MoodTimelineEntry[] {
  return loadJsonArray<MoodTimelineEntry>(MOOD_TIMELINE_KEY);
}

export function resetMoodTimelineForTests(): void {
  localStorage.removeItem(MOOD_TIMELINE_KEY);
}

export function recordMoodTimelineUpdate(input: {
  events: MoodEvent[];
  result: MoodUpdateResult;
}): MoodTimelineEntry | null {
  if (input.events.length === 0 && input.result.appliedImpacts.length === 0) {
    return null;
  }

  const delta = vectorDelta(input.result.debug.previous, input.result.nextMood);
  const strongest = strongestDelta(delta);
  const entry: MoodTimelineEntry = {
    id: `mood:${input.result.debug.now}:${input.events.map((event) => event.id).join("|")}`,
    timestamp: input.result.debug.now,
    eventTypes: unique(input.events.map((event) => event.type)),
    eventSources: unique(input.events.map((event) => event.source)),
    eventCount: input.events.length,
    strongestAxis: strongest.axis,
    strongestDelta: strongest.value,
    delta,
    next: input.result.nextMood,
    archetype: input.result.classification.archetype,
    emotion: input.result.classification.emotion,
    reason: buildReason({
      events: input.events,
      classification: input.result.classification,
      strongestAxis: strongest.axis,
      strongestDelta: strongest.value,
    }),
  };

  const timeline = loadMoodTimeline();
  saveJsonArray(MOOD_TIMELINE_KEY, [entry, ...timeline], MAX_MOOD_TIMELINE_ENTRIES);
  window.dispatchEvent(new Event("ari-mood-timeline-changed"));
  return entry;
}

export function formatMoodTimelineForDiagnostics(limit = 5): string[] {
  return loadMoodTimeline()
    .slice(0, limit)
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${time} ${entry.reason}`;
    });
}
