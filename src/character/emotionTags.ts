import {
  characterEmotions,
  isCharacterEmotion,
  type CharacterEmotion,
} from "../types/character";

const emotionPattern = characterEmotions.join("|");

const LEADING_EMOTION_LINE = new RegExp(
  `^\\s*(?:` +
    `<emotion>\\s*(?:${emotionPattern})\\s*</emotion>` +
    `|<(?:${emotionPattern})\\s*>` +
    `|emotion\\s*[:\\-]?\\s*(?:${emotionPattern})\\b` +
    `|(?:${emotionPattern})(?=\\s*(?:\\r?\\n|$))` +
    `)\\s*(?:\\r?\\n)?`,
  "i",
);

const SAME_LINE_PLAIN = new RegExp(
  `^\\s*emotion\\s*[:\\-]?\\s*(?:${emotionPattern})\\b\\s+`,
  "i",
);

const PARTIAL_EMOTION_PREFIX = /^\s*(?:<emotion>[^\n]*|emotion\s*[:\-]?\s*\w*)\s*$/i;

const PARSE_LEADING = new RegExp(
  `^\\s*(?:` +
    `<emotion>\\s*(${emotionPattern})` +
    `|<(${emotionPattern})\\s*>` +
    `|emotion\\s*[:\\-]?\\s*(${emotionPattern})\\b` +
    `|(${emotionPattern})(?=\\s*(?:\\r?\\n|$))` +
    `)`,
  "i",
);

function normalizeEmotion(value?: string): CharacterEmotion | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && isCharacterEmotion(normalized) ? normalized : null;
}

export function parseEmotionFromContent(
  content: string,
): CharacterEmotion | null {
  const leading = content.match(PARSE_LEADING);
  const fromLeading = normalizeEmotion(
    leading?.[1] ?? leading?.[2] ?? leading?.[3] ?? leading?.[4],
  );
  if (fromLeading) {
    return fromLeading;
  }

  const wrapped = content.match(
    new RegExp(`<emotion>\\s*(${emotionPattern})\\s*</emotion>`, "i"),
  );
  return normalizeEmotion(wrapped?.[1]);
}

export function stripEmotionMarkup(content: string): string {
  let text = content
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/^\s*<\/think>\s*/i, "");

  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(LEADING_EMOTION_LINE, "");
    text = text.replace(SAME_LINE_PLAIN, "");
  }

  if (PARTIAL_EMOTION_PREFIX.test(text)) {
    return "";
  }

  return text
    .replace(/<emotion>[\s\S]*?<\/emotion>/gi, "")
    .replace(/<\/?emotion\s*>/gi, "")
    .replace(new RegExp(`<\\/?(?:${emotionPattern})\\s*>`, "gi"), "")
    .trimStart();
}
