import type { CharacterEmotion } from "../../types/character";
import type { MoodArchetype } from "../moodBehavior";
import type { MoodClassificationResult } from "./moodClassifier";
import { classifyMood } from "./moodClassifier";
import type { MoodAxisConfigTable } from "./axisConfig";
import { DEFAULT_MOOD_AXES } from "./axisConfig";
import type { MoodVector } from "./moodVector";
import { clampVector } from "./moodVector";

export type MoodReplyLength = "short" | "normal" | "chatty";

export type MoodPolicy = {
  archetype: MoodArchetype;
  emotion: CharacterEmotion;
  replyLength: MoodReplyLength;
  sarcasm: number;
  warmth: number;
  initiativeBias: number;
  thoughtBubbleChance: number;
  thoughtBubbleCooldownScale: number;
  adviceAssertiveness: number;
  questionBias: number;
  refusalSharpness: number;
  preferredEmotions: CharacterEmotion[];
  promptLines: string[];
};

function clamp01(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function normSigned(value: number | undefined): number {
  return clamp01(((value ?? 0) + 1) / 2);
}

function preferredEmotionsFor(
  archetype: MoodArchetype,
  emotion: CharacterEmotion,
): CharacterEmotion[] {
  const byArchetype: Record<MoodArchetype, CharacterEmotion[]> = {
    irritated: ["annoyed", "determined", "amused", "worried"],
    playful: ["amused", "curious", "happy", "excited", "surprised"],
    warm: ["empathetic", "blush", "happy", "proud", "shy"],
    sleepy: ["sleepy", "bored", "pensive", "calm"],
    gloomy: ["pensive", "sad", "worried", "calm"],
    curious: ["curious", "determined", "amused", "surprised"],
    observant: ["curious", "calm", "pensive", "determined"],
    calm: ["calm", "neutral", "curious", "pensive", "empathetic"],
  };
  return Array.from(new Set([emotion, ...byArchetype[archetype]])).slice(0, 6);
}

function promptLinesFor(policy: Omit<MoodPolicy, "promptLines">): string[] {
  const lines: string[] = [
    `Mood policy: ${policy.archetype}; replyLength=${policy.replyLength}; sarcasm=${policy.sarcasm.toFixed(2)}; warmth=${policy.warmth.toFixed(2)}; adviceAssertiveness=${policy.adviceAssertiveness.toFixed(2)}; questionBias=${policy.questionBias.toFixed(2)}.`,
  ];
  if (policy.replyLength === "short") {
    lines.push("Длина по настроению: короче, плотнее, меньше разгона.");
  } else if (policy.replyLength === "chatty") {
    lines.push("Длина по настроению: можно чуть живее и разговорнее, если задача не требует краткости.");
  }
  if (policy.sarcasm > 0.55) {
    lines.push("Колкость слышна, но без оскорблений и без саботажа полезности.");
  }
  if (policy.adviceAssertiveness > 0.62) {
    lines.push("В советах выбирай уверенный один следующий шаг и критерий результата.");
  } else if (policy.questionBias > 0.58) {
    lines.push("Если фактов мало, лучше короткий точный вопрос, чем притянутый совет.");
  }
  if (policy.thoughtBubbleChance > 0.66) {
    lines.push("Внутренние мысли могут появляться чаще: настроение склонно к параллельным наблюдениям.");
  }
  return lines;
}

export function deriveMoodPolicy(
  vector: MoodVector,
  input: {
    axisConfig?: MoodAxisConfigTable;
    classification?: MoodClassificationResult;
    now?: number;
  } = {},
): MoodPolicy {
  const axisConfig = input.axisConfig ?? DEFAULT_MOOD_AXES;
  const mood = clampVector(vector, axisConfig);
  const classification =
    input.classification ??
    classifyMood(mood, { axisConfig, now: input.now ?? Date.now() });
  const warmth = normSigned(mood.warmth);
  const energy = normSigned(mood.energy);
  const irritation = normSigned(mood.irritation);
  const archetype = classification.archetype;

  let replyLength: MoodReplyLength = "normal";
  if (archetype === "irritated" || archetype === "sleepy" || energy < 0.36) {
    replyLength = "short";
  } else if (
    (archetype === "playful" || archetype === "warm" || archetype === "curious") &&
    energy > 0.62 &&
    irritation < 0.6
  ) {
    replyLength = "chatty";
  }

  const sarcasm = clamp01(0.2 + irritation * 0.72 + energy * 0.12 - warmth * 0.18);
  const initiativeBias = clamp01(0.42 + energy * 0.28 + warmth * 0.14 - irritation * 0.38);
  const thoughtBubbleChance = clamp01(
    0.48 +
      energy * 0.18 +
      (archetype === "playful" || archetype === "curious" ? 0.16 : 0) +
      (archetype === "irritated" ? -0.1 : 0) +
      (archetype === "sleepy" ? -0.16 : 0),
  );
  const thoughtBubbleCooldownScaleRaw =
    0.94 -
      (thoughtBubbleChance - 0.5) * 0.65 +
      (archetype === "sleepy" ? 0.35 : 0) +
      (archetype === "irritated" ? 0.16 : 0);
  const adviceAssertiveness = clamp01(
    0.42 +
      energy * 0.26 +
      (archetype === "curious" || archetype === "observant" ? 0.14 : 0) +
      irritation * 0.16,
  );
  const questionBias = clamp01(
    0.34 +
      irritation * 0.18 +
      (archetype === "sleepy" || archetype === "gloomy" ? 0.18 : 0) -
      energy * 0.12,
  );
  const refusalSharpness = clamp01(0.15 + irritation * 0.72 - warmth * 0.18);

  const base: Omit<MoodPolicy, "promptLines"> = {
    archetype,
    emotion: classification.emotion,
    replyLength,
    sarcasm,
    warmth,
    initiativeBias,
    thoughtBubbleChance,
    thoughtBubbleCooldownScale: Math.max(
      0.55,
      Math.min(1.55, thoughtBubbleCooldownScaleRaw),
    ),
    adviceAssertiveness,
    questionBias,
    refusalSharpness,
    preferredEmotions: preferredEmotionsFor(archetype, classification.emotion),
  };

  return {
    ...base,
    promptLines: promptLinesFor(base),
  };
}
