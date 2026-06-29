export const characterEmotions = [
  "neutral",
  "happy",
  "amused",
  "annoyed",
  "curious",
  "empathetic",
  "blush",
  "bored",
  "calm",
  "surprised",
  "sad",
  "sleepy",
  "excited",
  "pensive",
  "worried",
  "proud",
  "shy",
  "determined",
] as const;

export type CharacterEmotion = (typeof characterEmotions)[number];

export type CharacterState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export function isCharacterEmotion(
  value: string,
): value is CharacterEmotion {
  return characterEmotions.includes(value as CharacterEmotion);
}
