import type { CharacterEmotion } from "../types/character";
import { ariLog } from "../platform/logger";
import type { CharacterMood } from "./mood";
import { moodPreferredEmotion } from "./mood";
const KEY = "desktop-character.emotion-history.v1";
const MAX = 12;
export type EmotionRecordReason =
  | "model"
  | "initiative"
  | "mood"
  | "scene"
  | "error"
  | "click"
  | "idle"
  | "ambient";

export function recordEmotion(
  emotion: CharacterEmotion,
  reason: EmotionRecordReason = "model",
): void {
  ariLog("emotion", "debug", { emotion, reason });
  if (
    reason === "model" ||
    reason === "initiative" ||
    reason === "mood" ||
    reason === "scene" ||
    reason === "idle" ||
    reason === "ambient"
  ) {
    recordEmotionHistory(emotion);
  }
}

function recordEmotionHistory(emotion: CharacterEmotion): void {
  try {
    const history = loadEmotionHistory();
    history.push(emotion);
    localStorage.setItem(
      KEY,
      JSON.stringify(history.slice(-MAX)),
    );
  } catch {
    // ignore storage errors
  }
}

function loadEmotionHistory(): CharacterEmotion[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is CharacterEmotion => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function describeEmotionAntiRepeat(
  mood?: CharacterMood,
): string | null {
  const history = loadEmotionHistory();
  if (history.length < 3) {
    return null;
  }
  const recent = history.slice(-4);
  const preferred = mood ? moodPreferredEmotion(mood) : null;
  const underused: CharacterEmotion[] = [
    "pensive",
    "worried",
    "proud",
    "shy",
    "determined",
    "sad",
    "sleepy",
  ];
  const stale = underused.filter((emotion) => !recent.includes(emotion));
  if (preferred && stale.includes(preferred)) {
    return `Давно не было ${preferred} — если уместно, выбери <emotion>${preferred}</emotion>.`;
  }
  if (stale.length >= 4) {
    return `Расширь палитру: попробуй ${stale.slice(0, 3).join(", ")} если подходит настроению.`;
  }
  const neutralCount = recent.filter((emotion) => emotion === "neutral").length;
  const happyCount = recent.filter(
    (emotion) => emotion === "happy" || emotion === "amused",
  ).length;

  if (neutralCount >= 3) {
    return "Не используй neutral три раза подряд — выбери curious, calm, amused или empathetic по ситуации.";
  }
  if (happyCount >= 3) {
    return "Не застревай на happy/amused — добавь curious, calm, surprised или empathetic.";
  }
  if (recent.every((emotion) => emotion === recent[0])) {
    return `Не повторяй эмоцию ${recent[0]} подряд — смени тон реплики.`;
  }
  return null;
}
