import { clamp01 } from "../../platform/mathUtils";
import type { CharacterEmotion } from "../../types/character";
import { characterEmotions } from "../../types/character";
import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";
import type { MoodVector } from "./moodVector";
import { clampVector, createBaselineVector } from "./moodVector";
import type { MoodArchetype } from "../moodBehavior";
import { deriveMoodArchetype } from "../moodBehavior";

export type MoodClassificationResult = {
  emotion: CharacterEmotion;
  archetype: MoodArchetype;
  confidence: number;
  scores: Record<string, number>;
  reason: string[];
};

type EmotionRule = {
  id: CharacterEmotion;
  weight: number;
  score: (mood: MoodVector, ctx: { now: number }) => { score: number; reason: string[] };
};

function scoreRule(
  mood: MoodVector,
  ctx: { now: number },
  rule: EmotionRule,
): { id: CharacterEmotion; score: number; reason: string[] } {
  const out = rule.score(mood, ctx);
  const score = Number.isFinite(out.score) && !Number.isNaN(out.score) ? out.score : 0;
  return { id: rule.id, score: score * rule.weight, reason: out.reason };
}

function softStep(value: number, threshold: number, width = 0.12): number {
  // 0..1 curve around threshold
  const t = (value - threshold) / Math.max(0.0001, width);
  return 1 / (1 + Math.exp(-t));
}

const EMOTION_RULES: EmotionRule[] = [
  {
    id: "annoyed",
    weight: 1,
    score: (mood) => ({
      score: 0.18 + softStep(mood.irritation ?? 0, 0.14, 0.07) * 1.5,
      reason: ["irritation high"],
    }),
  },
  {
    id: "sleepy",
    weight: 1,
    score: (mood, ctx) => {
      const hour = new Date(ctx.now).getHours();
      const night = hour >= 23 || hour < 6 ? 0.2 : 0;
      const energy = mood.energy ?? 0;
      const veryLow = softStep(0.24 - energy, 0.04, 0.06);
      return { score: 0.14 + night + veryLow * 1.25, reason: ["low energy / late hour"] };
    },
  },
  {
    id: "bored",
    weight: 1,
    score: (mood) => {
      const energy = mood.energy ?? 0;
      const midLow =
        softStep(0.38 - energy, 0.1, 0.1) * softStep(energy - 0.16, 0.04, 0.06);
      return { score: 0.13 + midLow, reason: ["energy low"] };
    },
  },
  {
    id: "excited",
    weight: 1,
    score: (mood) => ({
      score:
        0.12 +
        softStep(mood.energy ?? 0, 0.68, 0.08) *
          (0.8 + softStep(mood.warmth ?? 0, 0.25, 0.12)),
      reason: ["energy high + warmth"],
    }),
  },
  {
    id: "happy",
    weight: 1,
    score: (mood) => {
      const energy = mood.energy ?? 0;
      const warmth = mood.warmth ?? 0;
      const notTooHyper = 1 - softStep(energy - 0.7, 0.04, 0.06) * 0.65;
      return {
        score:
          (0.14 +
            softStep(warmth, 0.32, 0.1) *
              (0.75 + softStep(energy - 0.32, 0.08, 0.1))) *
          notTooHyper,
        reason: ["warm + medium energy"],
      };
    },
  },
  {
    id: "amused",
    weight: 1,
    score: (mood) => {
      const energy = mood.energy ?? 0;
      const playfulBand =
        softStep(energy - 0.58, 0.06, 0.08) * softStep(0.78 - energy, 0.06, 0.08);
      return {
        score:
          0.12 +
          playfulBand *
            (0.85 + softStep(0.16 - (mood.irritation ?? 0), 0, 0.1)),
        reason: ["high energy + low irritation"],
      };
    },
  },
  {
    id: "curious",
    weight: 1,
    score: (mood) => {
      const energy = mood.energy ?? 0;
      const band =
        softStep(energy, 0.48, 0.08) * softStep(0.68 - energy, 0.08, 0.08);
      return {
        score:
          0.13 +
          band * (0.75 + softStep(0.2 - (mood.irritation ?? 0), 0, 0.1)),
        reason: ["energetic + not irritated"],
      };
    },
  },
  {
    id: "empathetic",
    weight: 1,
    score: (mood) => {
      const warmth = mood.warmth ?? 0;
      const energy = mood.energy ?? 0;
      const blushZone =
        softStep(warmth - 0.62, 0.04, 0.06) * softStep(0.4 - energy, 0.06, 0.08);
      const base =
        0.12 +
        softStep(warmth, 0.46, 0.08) *
          (0.75 + softStep(0.14 - (mood.irritation ?? 0), 0, 0.08));
      return {
        score: base * (1 - blushZone * 0.55),
        reason: ["very warm + calm"],
      };
    },
  },
  {
    id: "calm",
    weight: 1,
    score: (mood) => {
      const energy = mood.energy ?? 0;
      const irritation = mood.irritation ?? 0;
      const warmth = mood.warmth ?? 0;
      const centered =
        softStep(0.28 - Math.abs(energy - 0.44), 0.08, 0.1) *
        softStep(0.22 - Math.abs(irritation), 0.08, 0.1) *
        softStep(0.28 - Math.abs(warmth - 0.28), 0.1, 0.12);
      return { score: 0.22 + centered * 0.45, reason: ["stable / calm"] };
    },
  },
  {
    id: "pensive",
    weight: 1,
    score: (mood) => ({
      score:
        0.12 +
        softStep(0.46 - (mood.energy ?? 0), 0.1, 0.12) *
          (0.5 + softStep(mood.warmth ?? 0, 0.2, 0.18)),
      reason: ["lower energy + reflective"],
    }),
  },
  {
    id: "worried",
    weight: 1,
    score: (mood) => ({
      score:
        0.12 +
        softStep(mood.irritation ?? 0, 0.16, 0.08) *
          softStep(0.36 - (mood.warmth ?? 0), 0.1, 0.12),
      reason: ["slight irritation + lower warmth"],
    }),
  },
  {
    id: "sad",
    weight: 1,
    score: (mood) => ({
      score:
        0.08 +
        softStep(0.3 - (mood.energy ?? 0), 0.1, 0.12) *
          (0.7 + softStep(mood.warmth ?? 0, 0.15, 0.22)),
      reason: ["low energy"],
    }),
  },
  {
    id: "surprised",
    weight: 1,
    score: (mood) => ({
      score: 0.1 + softStep(mood.energy ?? 0, 0.8, 0.06),
      reason: ["very high energy spike"],
    }),
  },
  {
    id: "proud",
    weight: 1,
    score: (mood) => {
      const warmth = mood.warmth ?? 0;
      const energy = mood.energy ?? 0;
      const band =
        softStep(warmth, 0.4, 0.08) *
        softStep(0.62 - warmth, 0.08, 0.08) *
        softStep(energy, 0.44, 0.08) *
        softStep(0.66 - energy, 0.08, 0.08);
      return { score: 0.13 + band * 1.4, reason: ["warm + energized"] };
    },
  },
  {
    id: "determined",
    weight: 1,
    score: (mood) => {
      const energy = mood.energy ?? 0;
      const irritation = mood.irritation ?? 0;
      return {
        score:
          0.11 +
          softStep(energy, 0.52, 0.1) *
            softStep(0.72 - energy, 0.1, 0.1) *
            softStep(irritation, 0.1, 0.1) *
            softStep(0.28 - irritation, 0.08, 0.1),
        reason: ["focused energy"],
      };
    },
  },
  {
    id: "shy",
    weight: 1,
    score: (mood) => {
      const warmth = mood.warmth ?? 0;
      const energy = mood.energy ?? 0;
      return {
        score:
          0.13 +
          softStep(warmth, 0.64, 0.07) *
            softStep(0.36 - energy, 0.08, 0.1) *
            softStep(energy - 0.14, 0.04, 0.06),
        reason: ["very warm + quieter energy"],
      };
    },
  },
  {
    id: "blush",
    weight: 1,
    score: (mood) => {
      const warmth = mood.warmth ?? 0;
      const energy = mood.energy ?? 0;
      return {
        score:
          0.14 +
          softStep(warmth, 0.64, 0.06) * softStep(0.44 - energy, 0.08, 0.1),
        reason: ["extremely warm"],
      };
    },
  },
  {
    id: "neutral",
    weight: 1,
    score: () => ({ score: 0.2, reason: ["fallback neutral"] }),
  },
];

export function classifyMood(
  mood: MoodVector,
  input: { axisConfig?: MoodAxisConfigTable; now?: number } = {},
): MoodClassificationResult {
  const now = input.now ?? Date.now();
  const config = input.axisConfig ?? DEFAULT_MOOD_AXES;
  const clamped = clampVector(mood, config);
  const baseline = createBaselineVector(config);

  const ctx = { now };
  const scored = EMOTION_RULES.map((rule) => scoreRule(clamped, ctx, rule));
  // stable tie-break by rule order
  let winner = scored[0];
  for (let i = 1; i < scored.length; i += 1) {
    if (scored[i].score > winner.score) {
      winner = scored[i];
    }
  }
  const emotion = characterEmotions.includes(winner.id) ? winner.id : "neutral";

  // Reuse existing archetype derivation (still based on the existing axes).
  const archetype = deriveMoodArchetype({
    warmth: clamped.warmth ?? baseline.warmth,
    energy: clamped.energy ?? baseline.energy,
    irritation: clamped.irritation ?? baseline.irritation,
    updatedAt: now,
  });

  const scores: Record<string, number> = {};
  for (const entry of scored) {
    scores[entry.id] = entry.score;
  }

  const sorted = scored.slice().sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  const second = sorted[1]?.score ?? 0;
  const confidence = clamp01(top <= 0 ? 0 : (top - second) / Math.max(0.15, Math.abs(top)));

  return {
    emotion,
    archetype,
    confidence,
    scores,
    reason: [`winner=${winner.id} (${winner.score.toFixed(2)})`, ...winner.reason],
  };
}

