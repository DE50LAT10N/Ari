import type { AppSettings } from "../../settings/appSettings";
import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";
import type { MoodVector } from "./moodVector";
import { clampVector, createBaselineVector } from "./moodVector";
import type { MoodEvent } from "./moodEvents";
import { updateMood } from "./moodUpdateEngine";
import { adaptMoodToStyle } from "./moodStyleAdapter";
import { classifyMood } from "./moodClassifier";
import {
  loadMoodEngineState,
  persistLegacyMoodSnapshot,
  saveMoodEngineState,
} from "./moodEngineStore";
import { recordMoodTimelineUpdate } from "./moodTimeline";

const BASELINE_EVENT_WEIGHT = 0.16;
const REACTIVE_EVENT_WEIGHT = 0.84;
const BASELINE_DECAY_MULTIPLIER = 5.5;
const REACTIVE_DECAY_MULTIPLIER = 0.38;

export function isMoodEngineEnabled(settings: AppSettings): boolean {
  return settings.moodEngineEnabled !== false;
}

export function getCurrentMoodVector(input?: {
  now?: number;
  axisConfig?: MoodAxisConfigTable;
}): { vector: MoodVector; updatedAt: number } {
  const now = input?.now ?? Date.now();
  const axisConfig = input?.axisConfig ?? DEFAULT_MOOD_AXES;
  const state = loadMoodEngineState(now, axisConfig);
  return { vector: state.vector, updatedAt: state.updatedAt };
}

export function getCurrentMoodLayers(input?: {
  now?: number;
  axisConfig?: MoodAxisConfigTable;
}): {
  vector: MoodVector;
  baselineVector: MoodVector;
  reactiveVector: MoodVector;
  updatedAt: number;
} {
  const now = input?.now ?? Date.now();
  const axisConfig = input?.axisConfig ?? DEFAULT_MOOD_AXES;
  const state = loadMoodEngineState(now, axisConfig);
  const baseline = createBaselineVector(axisConfig);
  return {
    vector: state.vector,
    baselineVector: state.baselineVector ?? state.vector,
    reactiveVector: state.reactiveVector ?? baseline,
    updatedAt: state.updatedAt,
  };
}

function scaleEvents(events: MoodEvent[], scale: number, layer: string): MoodEvent[] {
  return events.map((event) => ({
    ...event,
    id: `${event.id}:${layer}`,
    intensity: event.intensity * scale,
    metadata: { ...event.metadata, moodLayer: layer },
  }));
}

function scaleAxisDecay(
  axisConfig: MoodAxisConfigTable,
  multiplier: number,
): MoodAxisConfigTable {
  const next: MoodAxisConfigTable = {};
  for (const [key, axis] of Object.entries(axisConfig)) {
    next[key] = {
      ...axis,
      decayHours: Math.max(0.05, axis.decayHours * multiplier),
    };
  }
  return next;
}

function combineMoodLayers(input: {
  baselineVector: MoodVector;
  reactiveVector: MoodVector;
  axisConfig: MoodAxisConfigTable;
}): MoodVector {
  const neutral = createBaselineVector(input.axisConfig);
  const combined: MoodVector = {};
  for (const axis of Object.values(input.axisConfig)) {
    combined[axis.id] =
      (input.baselineVector[axis.id] ?? axis.baseline) +
      (input.reactiveVector[axis.id] ?? axis.baseline) -
      (neutral[axis.id] ?? axis.baseline);
  }
  return clampVector(combined, input.axisConfig);
}

export function updateMoodFromEvents(input: {
  settings: AppSettings;
  events: MoodEvent[];
  now?: number;
  axisConfig?: MoodAxisConfigTable;
  options?: { applyDecay?: boolean; dryRun?: boolean };
}): ReturnType<typeof updateMood> & { persisted?: boolean } {
  const now = input.now ?? Date.now();
  const axisConfig = input.axisConfig ?? DEFAULT_MOOD_AXES;

  if (!isMoodEngineEnabled(input.settings)) {
    const baseline = createBaselineVector(axisConfig);
    const classification = classifyMood(baseline, { axisConfig, now });
    const debug = {
      now,
      previous: baseline,
      baseline,
      decayFactorByAxis: {},
      impacts: [],
      summedImpactByAxis: {},
      next: baseline,
      classification,
    };
    return {
      nextMood: baseline,
      appliedImpacts: [],
      classification,
      debug,
      persisted: false,
    };
  }

  const { vector, updatedAt } = getCurrentMoodVector({ now, axisConfig });
  const state = loadMoodEngineState(now, axisConfig);
  const neutral = createBaselineVector(axisConfig);
  const baselineAxisConfig = scaleAxisDecay(
    axisConfig,
    BASELINE_DECAY_MULTIPLIER,
  );
  const reactiveAxisConfig = scaleAxisDecay(
    axisConfig,
    REACTIVE_DECAY_MULTIPLIER,
  );
  const baselineResult = updateMood({
    currentMood: state.baselineVector ?? vector,
    currentUpdatedAt: updatedAt,
    events: scaleEvents(input.events, BASELINE_EVENT_WEIGHT, "baseline"),
    axisConfig: baselineAxisConfig,
    now,
    options: input.options,
  });
  const reactiveResult = updateMood({
    currentMood: state.reactiveVector ?? neutral,
    currentUpdatedAt: updatedAt,
    events: scaleEvents(input.events, REACTIVE_EVENT_WEIGHT, "reactive"),
    axisConfig: reactiveAxisConfig,
    now,
    options: input.options,
  });
  const nextMood = combineMoodLayers({
    baselineVector: baselineResult.nextMood,
    reactiveVector: reactiveResult.nextMood,
    axisConfig,
  });
  const classification = classifyMood(nextMood, { axisConfig, now });
  const result = {
    nextMood,
    appliedImpacts: [
      ...baselineResult.appliedImpacts,
      ...reactiveResult.appliedImpacts,
    ],
    classification,
    debug: {
      now,
      previous: vector,
      baseline: neutral,
      decayFactorByAxis: reactiveResult.debug.decayFactorByAxis,
      impacts: [
        ...baselineResult.debug.impacts,
        ...reactiveResult.debug.impacts,
      ],
      summedImpactByAxis: reactiveResult.debug.summedImpactByAxis,
      next: nextMood,
      classification,
    },
  };

  if (!input.options?.dryRun) {
    saveMoodEngineState(
      {
        version: 2,
        updatedAt: now,
        baselineVector: baselineResult.nextMood,
        reactiveVector: reactiveResult.nextMood,
        vector: result.nextMood,
        lastClassification: result.classification,
      },
      axisConfig,
    );
    persistLegacyMoodSnapshot(result.nextMood, now, axisConfig);
    recordMoodTimelineUpdate({ events: input.events, result });
    return { ...result, persisted: true };
  }
  return { ...result, persisted: false };
}

export function previewMoodImpact(input: {
  currentMood: MoodVector;
  currentUpdatedAt: number;
  events: MoodEvent[];
  now?: number;
  axisConfig?: MoodAxisConfigTable;
  options?: { applyDecay?: boolean };
}) {
  const now = input.now ?? Date.now();
  const axisConfig = input.axisConfig ?? DEFAULT_MOOD_AXES;
  return updateMood({
    currentMood: input.currentMood,
    currentUpdatedAt: input.currentUpdatedAt,
    events: input.events,
    axisConfig,
    now,
    options: { ...input.options, dryRun: true },
  });
}

export function classifyMoodVector(
  vector: MoodVector,
  input?: { axisConfig?: MoodAxisConfigTable; now?: number },
) {
  return classifyMood(vector, input);
}

export function moodVectorToPrompt(
  vector: MoodVector,
  input?: { axisConfig?: MoodAxisConfigTable; now?: number },
) {
  return adaptMoodToStyle(vector, input);
}

export {
  emotionToMoodEvent,
  interactionToMoodEvent,
  proactiveToMoodEvent,
  reactionToMoodEvent,
  triggerToMoodEvent,
  type MoodEvent,
} from "./moodEvents";
export { deriveMoodPolicy, type MoodPolicy } from "./moodPolicy";
export {
  formatMoodTimelineForDiagnostics,
  loadMoodTimeline,
  resetMoodTimelineForTests,
  type MoodTimelineEntry,
} from "./moodTimeline";


