import { clampSignedUnit } from "../platform/mathUtils";
import type { CharacterEmotion } from "../types/character";
import {
  decayMood,
  saveMood,
  type CharacterMood,
} from "./mood";

export type MoodTriggerKind =
  | "rude"
  | "pushy"
  | "playful"
  | "praise"
  | "thanks"
  | "affection"
  | "apology"
  | "user_tired"
  | "user_frustrated"
  | "neutral";

export type MoodTrigger = {
  kind: MoodTriggerKind;
  confidence: number;
  emotionHint?: CharacterEmotion;
};

type MoodShift = Pick<CharacterMood, "warmth" | "energy" | "irritation">;

export const MOOD_SHIFT_BY_TRIGGER: Record<MoodTriggerKind, MoodShift> = {
  rude: { warmth: -0.28, energy: 0.18, irritation: 0.38 },
  pushy: { warmth: -0.14, energy: 0.14, irritation: 0.22 },
  playful: { warmth: 0.22, energy: 0.48, irritation: -0.1 },
  praise: { warmth: 0.42, energy: 0.24, irritation: -0.28 },
  thanks: { warmth: 0.3, energy: 0.12, irritation: -0.24 },
  affection: { warmth: 0.5, energy: 0.16, irritation: -0.32 },
  apology: { warmth: 0.24, energy: -0.05, irritation: -0.42 },
  user_tired: { warmth: 0.36, energy: -0.2, irritation: -0.2 },
  user_frustrated: { warmth: 0.2, energy: 0.1, irritation: 0.2 },
  neutral: { warmth: 0, energy: 0, irritation: 0 },
};

const EMOTION_BY_TRIGGER: Record<MoodTriggerKind, CharacterEmotion | undefined> = {
  rude: "annoyed",
  pushy: "annoyed",
  playful: "amused",
  praise: "proud",
  thanks: "happy",
  affection: "blush",
  apology: "calm",
  user_tired: "empathetic",
  user_frustrated: "worried",
  neutral: undefined,
};

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function classifyMoodTrigger(text: string): MoodTrigger {
  const normalized = normalize(text);
  if (!normalized) {
    return { kind: "neutral", confidence: 0.3 };
  }

  const rules: Array<{ kind: MoodTriggerKind; confidence: number; pattern: RegExp }> = [
    {
      kind: "rude",
      confidence: 0.95,
      pattern:
        /(?:заткнись|бесишь|раздражаешь|тупая|дура|идиот|отвали|ненавижу|ты бесполезн|какая же ты)/i,
    },
    {
      kind: "pushy",
      confidence: 0.82,
      pattern:
        /(?:быстро|сейчас же|немедленно|без разговоров|просто сделай|я сказал|я сказала|хватит спорить|не умничай)/i,
    },
    {
      kind: "affection",
      confidence: 0.86,
      pattern:
        /(?:милая|солнышко|обнимаю|люблю тебя|ты чудо|ты прелесть|хочу тебя обнять|ты милая)/i,
    },
    {
      kind: "apology",
      confidence: 0.78,
      pattern: /(?:прости|извини|сорри|я погорячился|я погорячилась|не хотел грубо|не хотела грубо)/i,
    },
    {
      kind: "praise",
      confidence: 0.84,
      pattern:
        /(?:молодец|умница|классно|отлично|супер|ты помогла|ты права|хорошо сказала|круто сказала)/i,
    },
    {
      kind: "thanks",
      confidence: 0.78,
      pattern: /(?:спасибо|благодарю|пасиб|выручила|помогло|это помогло)/i,
    },
    {
      kind: "user_tired",
      confidence: 0.82,
      pattern:
        /(?:я устал|я устала|нет сил|выгорел|выгорела|хочу спать|мне тяжело|я exhausted|очень устал)/i,
    },
    {
      kind: "user_frustrated",
      confidence: 0.78,
      pattern:
        /(?:меня бесит|я злюсь|достало|всё сломалось|все сломалось|опять ошибка|ничего не работает|я в ярости)/i,
    },
    {
      kind: "playful",
      confidence: 0.74,
      pattern:
        /(?:ах ты|ну ты даешь|ну ты даёшь|хех|хаха|лол|подкол|шучу|ладно, смешно|сарказм принят|озорн)/i,
    },
  ];

  const match = rules.find((rule) => rule.pattern.test(normalized));
  if (!match) {
    return { kind: "neutral", confidence: normalized.length < 18 ? 0.35 : 0.45 };
  }

  return {
    kind: match.kind,
    confidence: match.confidence,
    emotionHint: EMOTION_BY_TRIGGER[match.kind],
  };
}

export function previewMoodAfterTrigger(
  mood: CharacterMood,
  trigger: MoodTrigger,
): CharacterMood {
  if (trigger.kind === "neutral" || trigger.confidence < 0.58) {
    return decayMood(mood);
  }
  const current = decayMood(mood);
  const shift = MOOD_SHIFT_BY_TRIGGER[trigger.kind];
  const weight = Math.max(0.55, Math.min(1, trigger.confidence));
  return {
    warmth: clampSignedUnit(current.warmth + shift.warmth * weight),
    energy: clampSignedUnit(current.energy + shift.energy * weight),
    irritation: clampSignedUnit(current.irritation + shift.irritation * weight),
    updatedAt: Date.now(),
  };
}

export function applyMoodTriggerToMood(
  mood: CharacterMood,
  trigger: MoodTrigger,
): CharacterMood {
  return saveMood(previewMoodAfterTrigger(mood, trigger));
}

export function moodTriggerEmotionHint(trigger: MoodTrigger): CharacterEmotion | null {
  return trigger.confidence >= 0.7 ? trigger.emotionHint ?? null : null;
}

export function describeMoodTrigger(trigger: MoodTrigger): string | null {
  if (trigger.kind === "neutral" || trigger.confidence < 0.58) {
    return null;
  }
  return {
    rude: "User sounded rude or dismissive; Ari may become sharper and visibly irritated.",
    pushy: "User sounded pushy; Ari may resist being overly service-like.",
    playful: "User invited playful banter; Ari can become more mischievous.",
    praise: "User praised Ari; Ari can warm up and feel proud.",
    thanks: "User thanked Ari; Ari can soften and brighten.",
    affection: "User showed affection; Ari can become warmer or shy.",
    apology: "User apologized; Ari can cool down and soften.",
    user_tired: "User sounds tired; Ari should become warmer and calmer.",
    user_frustrated: "User is frustrated with the situation; Ari can be concerned without becoming hostile.",
    neutral: "",
  }[trigger.kind];
}
