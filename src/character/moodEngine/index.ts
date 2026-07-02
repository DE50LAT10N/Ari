import type { AppSettings } from "../../settings/appSettings";
import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";
import type { MoodVector } from "./moodVector";
import { createBaselineVector } from "./moodVector";
import type { MoodEvent } from "./moodEvents";
import { updateMood } from "./moodUpdateEngine";
import { adaptMoodToStyle } from "./moodStyleAdapter";
import { classifyMood } from "./moodClassifier";
import {
  loadMoodEngineState,
  persistLegacyMoodSnapshot,
  saveMoodEngineState,
} from "./moodEngineStore";

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
  const result = updateMood({
    currentMood: vector,
    currentUpdatedAt: updatedAt,
    events: input.events,
    axisConfig,
    now,
    options: input.options,
  });

  if (!input.options?.dryRun) {
    saveMoodEngineState(
      {
        version: 2,
        updatedAt: now,
        vector: result.nextMood,
        lastClassification: result.classification,
      },
      axisConfig,
    );
    persistLegacyMoodSnapshot(result.nextMood, now, axisConfig);
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

export { interactionToMoodEvent, emotionToMoodEvent, triggerToMoodEvent } from "./moodEvents";


