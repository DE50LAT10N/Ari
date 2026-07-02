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

function clamp01(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const EMOTION_RULES: EmotionRule[] = [
  {
    id: "annoyed",
    weight: 1,
    score: (mood) => ({
      score: 0.2 + softStep(mood.irritation ?? 0, 0.22, 0.08) * 1.4,
      reason: ["irritation high"],
    }),
  },
  {
    id: "sleepy",
    weight: 1,
    score: (mood, ctx) => {
      const hour = new Date(ctx.now).getHours();
      const night = hour >= 23 || hour < 6 ? 0.35 : 0;
      const lowEnergy = softStep(0.28 - (mood.energy ?? 0), 0.1, 0.08);
      return { score: 0.15 + night + lowEnergy, reason: ["low energy / late hour"] };
    },
  },
  {
    id: "bored",
    weight: 1,
    score: (mood) => ({
      score: 0.12 + softStep(0.38 - (mood.energy ?? 0), 0.12, 0.1),
      reason: ["energy low"],
    }),
  },
  {
    id: "excited",
    weight: 1,
    score: (mood) => ({
      score:
        0.08 +
        softStep(mood.energy ?? 0, 0.62, 0.1) *
          (0.6 + softStep(mood.warmth ?? 0, 0.35, 0.12)),
      reason: ["energy high + warmth"],
    }),
  },
  {
    id: "happy",
    weight: 1,
    score: (mood) => ({
      score:
        0.12 +
        softStep(mood.warmth ?? 0, 0.42, 0.12) *
          (0.7 + softStep(mood.energy ?? 0, 0.45, 0.12)),
      reason: ["warm + medium energy"],
    }),
  },
  {
    id: "amused",
    weight: 1,
    score: (mood) => ({
      score:
        0.1 +
        softStep(mood.energy ?? 0, 0.55, 0.12) *
          (0.6 + softStep(0.18 - (mood.irritation ?? 0), 0, 0.12)),
      reason: ["high energy + low irritation"],
    }),
  },
  {
    id: "curious",
    weight: 1,
    score: (mood) => ({
      score:
        0.1 +
        softStep(mood.energy ?? 0, 0.5, 0.12) *
          (0.6 + softStep(0.22 - (mood.irritation ?? 0), 0, 0.12)),
      reason: ["energetic + not irritated"],
    }),
  },
  {
    id: "empathetic",
    weight: 1,
    score: (mood) => ({
      score:
        0.1 +
        softStep(mood.warmth ?? 0, 0.56, 0.1) *
          (0.7 + softStep(0.18 - (mood.irritation ?? 0), 0, 0.1)),
      reason: ["very warm + calm"],
    }),
  },
  {
    id: "calm",
    weight: 1,
    score: (mood) => ({
      score:
        0.25 +
        softStep(0.24 - Math.abs(mood.energy ?? 0.45), 0.1, 0.12) *
          softStep(0.2 - Math.abs(mood.irritation ?? 0), 0.1, 0.12),
      reason: ["stable / calm"],
    }),
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
        0.1 +
        softStep(mood.irritation ?? 0, 0.12, 0.1) *
          softStep(0.48 - (mood.warmth ?? 0.25), 0.1, 0.18),
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
      score: 0.06 + softStep(mood.energy ?? 0, 0.72, 0.08),
      reason: ["very high energy spike"],
    }),
  },
  {
    id: "proud",
    weight: 1,
    score: (mood) => ({
      score:
        0.08 +
        softStep(mood.warmth ?? 0, 0.45, 0.12) *
          softStep(mood.energy ?? 0, 0.48, 0.12),
      reason: ["warm + energized"],
    }),
  },
  {
    id: "determined",
    weight: 1,
    score: (mood) => ({
      score:
        0.08 +
        softStep(mood.energy ?? 0, 0.48, 0.12) *
          softStep(mood.irritation ?? 0, 0.06, 0.12),
      reason: ["focused energy"],
    }),
  },
  {
    id: "shy",
    weight: 1,
    score: (mood) => ({
      score: 0.06 + softStep(mood.warmth ?? 0, 0.62, 0.1) * softStep(0.4 - (mood.energy ?? 0), 0.12, 0.12),
      reason: ["very warm + quieter energy"],
    }),
  },
  {
    id: "blush",
    weight: 1,
    score: (mood) => ({
      score: 0.06 + softStep(mood.warmth ?? 0, 0.7, 0.08),
      reason: ["extremely warm"],
    }),
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

