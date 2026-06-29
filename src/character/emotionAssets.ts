import {
  characterEmotions,
  type CharacterEmotion,
} from "../types/character";

/** Каталог PNG под public/. Положи файлы в public/characters/ari/alpha/ */
export const EMOTION_SPRITE_DIR = "/characters/ari/alpha";

/**
 * Новые эмоции (добавь PNG с тем же именем):
 * - sad.png       — грусть, разочарование
 * - sleepy.png    — сонная, усталая
 * - excited.png   — воодушевление
 * - pensive.png   — задумчивость
 * - worried.png   — беспокойство
 * - proud.png     — гордость
 * - shy.png       — застенчивость
 * - determined.png — собранность, фокус
 */
export const emotionSpriteFiles: Record<CharacterEmotion, string> = {
  neutral: "neutral.png",
  happy: "happy.png",
  amused: "amused.png",
  annoyed: "annoyed.png",
  curious: "curious.png",
  empathetic: "empathetic.png",
  blush: "blush.png",
  bored: "bored.png",
  calm: "calm smile.png",
  surprised: "surprised.png",
  sad: "sad.png",
  sleepy: "sleepy.png",
  excited: "excited.png",
  pensive: "pensive.png",
  worried: "worried.png",
  proud: "proud.png",
  shy: "shy.png",
  determined: "determined.png",
};

export const emotionSpritePaths: Record<CharacterEmotion, string> =
  Object.fromEntries(
    Object.entries(emotionSpriteFiles).map(([emotion, file]) => [
      emotion,
      `${EMOTION_SPRITE_DIR}/${encodeURI(file)}`,
    ]),
  ) as Record<CharacterEmotion, string>;

/** Состояния аватара — отдельные PNG поверх эмоций. */
export const stateSpriteFiles = {
  idle: "idle.png",
  speaking: "speaking.png",
} as const;

export const stateSpritePaths = {
  idle: `${EMOTION_SPRITE_DIR}/${encodeURI(stateSpriteFiles.idle)}`,
  speaking: `${EMOTION_SPRITE_DIR}/${encodeURI(stateSpriteFiles.speaking)}`,
} as const;

/** Все ожидаемые PNG в alpha/ (для проверок и документации). */
export const allAlphaSpriteFiles = [
  ...new Set([...Object.values(emotionSpriteFiles), ...Object.values(stateSpriteFiles)]),
];

/** Резерв только при ошибке загрузки файла (onerror в Avatar). */
export const emotionSpriteFallback: Partial<
  Record<CharacterEmotion, CharacterEmotion>
> = {};

export function resolveEmotionSpritePath(emotion: CharacterEmotion): string {
  return emotionSpritePaths[emotion];
}

export function resolveEmotionSpriteFallbackPath(
  emotion: CharacterEmotion,
): string {
  let current: CharacterEmotion = emotion;
  const seen = new Set<CharacterEmotion>();
  while (emotionSpriteFallback[current] && !seen.has(current)) {
    seen.add(current);
    current = emotionSpriteFallback[current]!;
  }
  if (current !== emotion) {
    return emotionSpritePaths[current];
  }
  return emotion === "neutral"
    ? stateSpritePaths.idle
    : emotionSpritePaths.neutral;
}

/** Краткие подсказки для system prompt — когда какую эмоцию выбирать. */
export const emotionUsageHints: Record<CharacterEmotion, string> = {
  neutral: "нейтральный тон",
  happy: "радость, одобрение",
  amused: "ирония, подкол",
  annoyed: "раздражение, укол",
  curious: "интерес, разбор",
  empathetic: "сочувствие пользователю",
  blush: "смущение от комплимента",
  bored: "скука, апатия",
  calm: "спокойствие, ровный тон",
  surprised: "неожиданность",
  sad: "грусть, мягкое разочарование",
  sleepy: "усталость, ночь, низкая энергия",
  excited: "оживление, воодушевление",
  pensive: "задумчивость, пауза перед ответом",
  worried: "беспокойство за пользователя",
  proud: "гордость за пользователя",
  shy: "застенчивость, робость",
  determined: "собранность, фокус на задаче",
};

export function formatEmotionListForPrompt(): string {
  return characterEmotions.join(", ");
}

export function formatEmotionGuideForPrompt(): string {
  return characterEmotions
    .map((emotion) => `${emotion} — ${emotionUsageHints[emotion]}`)
    .join("; ");
}

export const NEW_EMOTIONS: CharacterEmotion[] = [
  "sad",
  "sleepy",
  "excited",
  "pensive",
  "worried",
  "proud",
  "shy",
  "determined",
];
