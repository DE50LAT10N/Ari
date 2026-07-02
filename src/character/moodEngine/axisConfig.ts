export type MoodAxisConfig = {
  id: string;
  min: number;
  max: number;
  baseline: number;
  /** Exponential decay half-life-ish control (hours). */
  decayHours: number;
  weight?: number;
  description?: string;
  /**
   * Optional mapping hints to existing project categories.
   * This is metadata only (no business logic should depend on it).
   */
  categoryHints?: {
    archetypes?: string[];
    emotions?: string[];
  };
};

export type MoodAxisConfigTable = Record<string, MoodAxisConfig>;

export const DEFAULT_MOOD_AXES: MoodAxisConfigTable = {
  warmth: {
    id: "warmth",
    min: -1,
    max: 1,
    baseline: 0.25,
    decayHours: 4,
    weight: 1,
    description: "От холодной/дистанцированной к тёплой/поддерживающей.",
  },
  energy: {
    id: "energy",
    min: -1,
    max: 1,
    baseline: 0.45,
    decayHours: 4,
    weight: 1,
    description: "От вялой/медленной к бодрой/оживлённой.",
  },
  irritation: {
    id: "irritation",
    min: -1,
    max: 1,
    baseline: 0,
    decayHours: 4,
    weight: 1,
    description: "От спокойной к раздражённой/колкой.",
  },
};

export function listMoodAxes(config: MoodAxisConfigTable): MoodAxisConfig[] {
  return Object.values(config);
}

export function getAxis(config: MoodAxisConfigTable, axisId: string): MoodAxisConfig {
  const axis = config[axisId];
  if (!axis) {
    throw new Error(`Unknown mood axis: ${axisId}`);
  }
  return axis;
}

