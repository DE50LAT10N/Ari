import type { CharacterEmotion } from "../types/character";
import { describeMoodBehaviorForPrompt } from "./moodBehavior";
import { dayKey } from "./datetime";

export type CharacterMood = {
  warmth: number;
  energy: number;
  irritation: number;
  updatedAt: number;
};

const MOOD_KEY = "desktop-character.ari-mood.v1";
const MOOD_DRIFT_KEY = "desktop-character.mood-drift.v1";

const neutralMood: CharacterMood = {
  warmth: 0.25,
  energy: 0.45,
  irritation: 0,
  updatedAt: Date.now(),
};

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function hashDay(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return (hash % 1000) / 1000;
}

function getDailyMoodDrift(): Pick<CharacterMood, "warmth" | "energy" | "irritation"> {
  const key = dayKey();
  try {
    const stored = JSON.parse(
      localStorage.getItem(MOOD_DRIFT_KEY) ?? "null",
    ) as { date?: string; warmth?: number; energy?: number; irritation?: number } | null;
    if (stored?.date === key) {
      return {
        warmth: stored.warmth ?? 0,
        energy: stored.energy ?? 0,
        irritation: stored.irritation ?? 0,
      };
    }
  } catch {
    // regenerate
  }
  const drift = {
    warmth: (hashDay(`${key}-w`) - 0.5) * 0.14,
    energy: (hashDay(`${key}-e`) - 0.5) * 0.16,
    irritation: (hashDay(`${key}-i`) - 0.5) * 0.08,
  };
  localStorage.setItem(
    MOOD_DRIFT_KEY,
    JSON.stringify({ date: key, ...drift }),
  );
  return drift;
}

export function decayMood(mood: CharacterMood): CharacterMood {
  const elapsedHours = Math.max(0, Date.now() - mood.updatedAt) / 3_600_000;
  const factor = Math.exp(-elapsedHours / 4);
  const drift = getDailyMoodDrift();
  const relationship = loadRelationshipBondWarmth();

  return {
    warmth: clamp(
      0.25 +
        drift.warmth +
        relationship +
        (mood.warmth - 0.25 - drift.warmth - relationship) * factor,
    ),
    energy: clamp(0.45 + drift.energy + (mood.energy - 0.45 - drift.energy) * factor),
    irritation: clamp(mood.irritation * factor + drift.irritation * 0.35),
    updatedAt: Date.now(),
  };
}

function loadRelationshipBondWarmth(): number {
  try {
    const stored = JSON.parse(
      localStorage.getItem("desktop-character.ari-relationship.v1") ?? "null",
    ) as { familiarity?: number; trust?: number; playfulness?: number } | null;
    if (!stored) return 0;
    const score =
      (stored.familiarity ?? 0) * 0.4 +
      (stored.trust ?? 0) * 0.45 +
      (stored.playfulness ?? 0) * 0.15;
    return Math.max(0, Math.min(0.12, (score - 0.15) * 0.18));
  } catch {
    return 0;
  }
}

let moodCache: CharacterMood | null = null;

export function loadMood(): CharacterMood {
  if (moodCache) {
    return moodCache;
  }
  try {
    const stored = JSON.parse(
      localStorage.getItem(MOOD_KEY) ?? "null",
    ) as Partial<CharacterMood> | null;
    if (!stored) {
      moodCache = decayMood(neutralMood);
      return moodCache;
    }

    moodCache = decayMood({
      warmth:
        typeof stored.warmth === "number" ? stored.warmth : 0.25,
      energy:
        typeof stored.energy === "number" ? stored.energy : 0.45,
      irritation:
        typeof stored.irritation === "number" ? stored.irritation : 0,
      updatedAt:
        typeof stored.updatedAt === "number"
          ? stored.updatedAt
          : Date.now(),
    });
    return moodCache;
  } catch {
    moodCache = decayMood(neutralMood);
    return moodCache;
  }
}

export function saveMood(mood: CharacterMood): CharacterMood {
  const stable = {
    warmth: clamp(mood.warmth),
    energy: clamp(mood.energy),
    irritation: clamp(mood.irritation),
    updatedAt: Date.now(),
  };
  moodCache = stable;
  localStorage.setItem(MOOD_KEY, JSON.stringify(stable));
  return stable;
}

export function applyEmotionToMood(
  mood: CharacterMood,
  emotion: CharacterEmotion,
): CharacterMood {
  const current = decayMood(mood);
  const shifts: Record<
    CharacterEmotion,
    Pick<CharacterMood, "warmth" | "energy" | "irritation">
  > = {
    neutral: { warmth: 0, energy: -0.04, irritation: -0.06 },
    happy: { warmth: 0.22, energy: 0.14, irritation: -0.14 },
    amused: { warmth: 0.13, energy: 0.2, irritation: -0.05 },
    annoyed: { warmth: -0.12, energy: 0.09, irritation: 0.28 },
    curious: { warmth: 0.05, energy: 0.15, irritation: -0.04 },
    empathetic: { warmth: 0.24, energy: -0.04, irritation: -0.14 },
    blush: { warmth: 0.28, energy: 0.06, irritation: -0.12 },
    bored: { warmth: -0.03, energy: -0.2, irritation: 0.05 },
    calm: { warmth: 0.14, energy: -0.09, irritation: -0.16 },
    surprised: { warmth: 0.03, energy: 0.26, irritation: -0.03 },
    sad: { warmth: 0.08, energy: -0.12, irritation: 0.02 },
    sleepy: { warmth: 0.02, energy: -0.24, irritation: 0.03 },
    excited: { warmth: 0.18, energy: 0.28, irritation: -0.1 },
    pensive: { warmth: 0.04, energy: -0.06, irritation: -0.05 },
    worried: { warmth: 0.12, energy: 0.04, irritation: 0.08 },
    proud: { warmth: 0.2, energy: 0.12, irritation: -0.12 },
    shy: { warmth: 0.16, energy: -0.02, irritation: -0.08 },
    determined: { warmth: 0.06, energy: 0.08, irritation: -0.04 },
  };
  const shift = shifts[emotion];

  return saveMood({
    warmth: current.warmth + shift.warmth,
    energy: current.energy + shift.energy,
    irritation: current.irritation + shift.irritation,
    updatedAt: Date.now(),
  });
}

export function applyInteractionToMood(
  mood: CharacterMood,
  interaction:
    | "click"
    | "repeated-clicks"
    | "return"
    | "headpat"
    | "chat_positive"
    | "ignored_initiative"
    | "long_silence",
): CharacterMood {
  const current = decayMood(mood);
  const shift =
    interaction === "repeated-clicks"
      ? { warmth: -0.07, energy: 0.14, irritation: 0.22 }
      : interaction === "return"
        ? { warmth: 0.16, energy: 0.09, irritation: -0.09 }
        : interaction === "headpat"
          ? { warmth: 0.2, energy: 0.06, irritation: -0.12 }
          : interaction === "chat_positive"
            ? { warmth: 0.1, energy: 0.06, irritation: -0.05 }
            : interaction === "ignored_initiative"
              ? { warmth: -0.04, energy: -0.03, irritation: 0.08 }
              : interaction === "long_silence"
                ? { warmth: -0.02, energy: -0.05, irritation: 0.03 }
                : { warmth: 0.03, energy: 0.05, irritation: 0.015 };

  return saveMood({
    warmth: current.warmth + shift.warmth,
    energy: current.energy + shift.energy,
    irritation: current.irritation + shift.irritation,
    updatedAt: Date.now(),
  });
}

export function moodInitiativeBias(mood: CharacterMood): number {
  const current = decayMood(mood);
  let bias = 0;
  if (current.warmth > 0.52) bias += 0.28;
  else if (current.warmth < 0.1) bias -= 0.12;
  if (current.energy > 0.58) bias += 0.22;
  else if (current.energy < 0.3) bias -= 0.22;
  if (current.irritation > 0.38) bias -= 0.34;
  else if (current.irritation > 0.18) bias -= 0.14;
  return bias;
}

export function moodAmbientReactionChance(
  mood: CharacterMood,
  base = 0.72,
): number {
  return Math.max(0.32, Math.min(0.9, base + moodInitiativeBias(mood)));
}

export function moodPreferredEmotion(mood: CharacterMood): CharacterEmotion | null {
  const current = decayMood(mood);
  const hour = new Date().getHours();
  if (current.irritation > 0.42) return "annoyed";
  if (current.warmth > 0.58) return "empathetic";
  if (current.energy < 0.22 || (hour >= 23 || hour < 6)) return "sleepy";
  if (current.energy < 0.28) return "bored";
  if (current.energy > 0.68) return "excited";
  if (current.energy > 0.62) return "amused";
  if (current.warmth > 0.45 && current.irritation < 0.12) return "happy";
  return null;
}

function describeMood(mood: CharacterMood): string {
  const current = decayMood(mood);
  const traits: string[] = [];
  const hour = new Date().getHours();

  if (current.irritation > 0.42) traits.push("заметно раздражённая");
  else if (current.irritation > 0.18) traits.push("колкая и язвительная");
  if (current.warmth > 0.52) traits.push("особенно тёплая и мягкая");
  else if (current.warmth < 0.08) traits.push("держит ироничную дистанцию");
  if (current.energy > 0.58) traits.push("оживлённая и бойкая");
  else if (current.energy < 0.32) traits.push("сонная и медленная");
  if (hour >= 0 && hour < 6) traits.push("ощущает глубокую ночь");
  else if (hour >= 22) traits.push("становится тише к ночи");
  else if (hour >= 6 && hour < 10) traits.push("утренняя и чуть мягче");

  return traits.length ? traits.join(", ") : "спокойная, привычно ироничная";
}

export function describeMoodForPrompt(mood: CharacterMood): string {
  const current = decayMood(mood);
  const lines = [`Сводка: ${describeMood(current)}.`];

  if (current.irritation > 0.3) {
    lines.push(
      "Говори короче и острее; допускай уколотость и сухую иронию, но без грубости.",
      "Не будь сервисной, восторженной и «полезной» — колкость и наблюдательность важнее.",
      "Лексика: резче, суше, меньше слов; можно подколоть.",
      "Предпочитай <emotion>annoyed</emotion> или <emotion>amused</emotion>.",
    );
  } else if (current.warmth > 0.48) {
    lines.push(
      "Тон заметно теплее: больше поддержки и участия, без приторности и лести.",
      "Лексика: мягче, «рядом», меньше иронии на человека.",
      "Предпочитай <emotion>empathetic</emotion>, <emotion>calm</emotion>, <emotion>happy</emotion> или <emotion>proud</emotion>.",
    );
  } else if (current.energy < 0.32) {
    lines.push(
      "Темп медленнее: меньше слов, спокойная подача.",
      "Лексика: вялый ритм, короткие фразы, без энтузиазма.",
      "Предпочитай <emotion>sleepy</emotion>, <emotion>bored</emotion>, <emotion>calm</emotion> или <emotion>pensive</emotion>.",
    );
  } else {
    lines.push(
      "Держи фирменную Ari-иронию: живо, на «ты», без канцелярита и без роли «виртуального помощника».",
    );
  }

  if (current.energy > 0.58) {
    lines.push(
      "Темп живее: короткие фразы, больше оживления, можно резче перебивать мысль.",
      "Лексика: бойче, оживлённее, больше восклицаний без крика.",
      "Подходят <emotion>excited</emotion>, <emotion>amused</emotion>, <emotion>curious</emotion>.",
    );
  }

  if (current.irritation > 0.45) {
    lines.push(
      "Раздражение заметно: не сглаживай тон — пусть чувствуется в формулировках.",
    );
  }

  lines.push(
    describeMoodBehaviorForPrompt(current),
    "Настроение должно быть слышно в каждой реплике — в словах, ритме и выборе эмоции. Не называй настроение напрямую и не объясняй механику.",
  );

  return lines.join("\n");
}
