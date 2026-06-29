import type { CharacterEmotion } from "../types/character";
import { parseEmotionFromContent } from "./emotionTags";
import type { ResponseMode } from "./responseModes";
import type { CharacterMood } from "./mood";
import { moodPreferredEmotion } from "./mood";

export function softenEmotionForMood(
  target: CharacterEmotion,
  current: CharacterEmotion,
  mood: CharacterMood,
): CharacterEmotion {
  const biased = biasEmotionByMood(target, mood);
  if (biased === current) {
    return current;
  }

  if (
    mood.irritation > 0.35 &&
    (biased === "annoyed" || biased === "amused")
  ) {
    return biased;
  }
  if (mood.energy > 0.55 && biased !== "neutral") {
    const lively = new Set<CharacterEmotion>([
      "excited",
      "surprised",
      "amused",
      "happy",
      "curious",
    ]);
    if (lively.has(biased)) {
      return biased;
    }
  }

  const lively = new Set<CharacterEmotion>([
    "excited",
    "surprised",
    "amused",
    "happy",
  ]);
  if (mood.energy < 0.35 && lively.has(biased) && !lively.has(current)) {
    return biased === "excited" ? "happy" : "calm";
  }
  if (mood.irritation < 0.12 && biased === "annoyed" && target !== "annoyed") {
    return current === "neutral" ? "curious" : current;
  }
  if (mood.warmth < 0.3 && (biased === "blush" || biased === "shy")) {
    return "calm";
  }
  if (mood.warmth > 0.55 && biased === "neutral" && current !== "neutral") {
    return "calm";
  }

  return biased;
}

export function biasEmotionByMood(
  emotion: CharacterEmotion,
  mood: CharacterMood,
): CharacterEmotion {
  if (mood.irritation > 0.45 && emotion === "neutral") {
    return "annoyed";
  }
  if (mood.irritation > 0.25 && emotion === "happy") {
    return "amused";
  }
  if (mood.warmth > 0.45 && emotion === "neutral") {
    return "empathetic";
  }
  if (mood.energy < 0.28 && emotion === "happy") {
    return "calm";
  }
  if (mood.energy < 0.22 && emotion === "neutral") {
    return "bored";
  }
  if (mood.energy < 0.28 && emotion === "neutral") {
    return "sleepy";
  }
  if (mood.warmth > 0.55 && emotion === "happy") {
    return "excited";
  }
  return emotion;
}

export function fuseRelationshipMoodEmotion(
  emotion: CharacterEmotion,
  mood: CharacterMood,
  tone: import("./relationshipTone").RelationshipTone,
): CharacterEmotion {
  if (tone === "guarded") {
    if (emotion === "happy" || emotion === "excited") return "calm";
    if (emotion === "neutral") return mood.irritation > 0.35 ? "annoyed" : "calm";
  }
  if (tone === "trusted_warm" && emotion === "neutral") {
    return moodPreferredEmotion(mood) ?? "empathetic";
  }
  return emotion;
}

export function inferEmotionFromReply(
  text: string,
  responseMode?: ResponseMode,
): CharacterEmotion {
  const tagged = parseEmotionFromContent(text);
  if (tagged) {
    return tagged;
  }

  const lower = text.toLowerCase();

  if (/(груст|печал|жаль, что|расстро|тоск)/i.test(lower)) {
    return "sad";
  }
  if (/(устал|сонн|засыпа|ночь уже|глаза слипа)/i.test(lower)) {
    return "sleepy";
  }
  if (/(ура|вау|круто|не могу дожд|оживл|заряд)/i.test(lower)) {
    return "excited";
  }
  if (/(думаю|задумал|мм+|хм+|пауза|размыш)/i.test(lower)) {
    return "pensive";
  }
  if (/(беспок|волную|пережива|надеюсь, ты|осторожн)/i.test(lower)) {
    return "worried";
  }
  if (/(молодец|горжусь|получилось|классно справ|умничка)/i.test(lower)) {
    return "proud";
  }
  if (/(стесн|робк|не смотри|я… эм)/i.test(lower)) {
    return "shy";
  }
  if (/(сосредот|фокус|давай по делу|соберись|сделаем)/i.test(lower)) {
    return "determined";
  }
  if (/(сарказм|ну да конечно|как же|ага, щас|молодец, правда)/i.test(lower)) {
    return "amused";
  }
  if (/(не компил|ошибк|баг|падает|сломал|не работает|бесит код)/i.test(lower)) {
    return "annoyed";
  }
  if (/(давай разбер|посмотрим лог|интересн|а если|проверим)/i.test(lower)) {
    return "curious";
  }
  if (/(жаль|извини|понимаю|тяжело|поддерж|непросто|сочувств)/i.test(lower)) {
    return "empathetic";
  }
  if (/(ха-ха|смешн|шутк|иронич|забавн|подколол)/i.test(lower)) {
    return "amused";
  }
  if (/(ого|неожидан|вот это|серьёзно\?|что\?!)/i.test(lower)) {
    return "surprised";
  }
  if (/(раздраж|бесит|опять ты|ну конечно|хватит)/i.test(lower)) {
    return "annoyed";
  }
  if (/(интересн|любопытн|посмотрим|а что если|заглян)/i.test(lower)) {
    return "curious";
  }
  if (/(спокойно|выдохни|тихо|без паники|ровно)/i.test(lower)) {
    return "calm";
  }
  if (/(скучн|лень|устал|зевок)/i.test(lower)) {
    return "bored";
  }
  if (/(мило|стыдн|красне|смущ)/i.test(lower)) {
    return "blush";
  }
  if (/(отлично|рада|класс|супер|ура|здорово)/i.test(lower)) {
    return "happy";
  }

  switch (responseMode) {
    case "emotional_support":
      return "empathetic";
    case "teasing":
      return "amused";
    case "serious_warning":
      return "determined";
    case "technical_help":
      return "curious";
    case "reminder":
      return "calm";
    case "idle_initiative":
      return "curious";
    case "vision_commentary":
      return "curious";
    case "return_reaction":
      return "happy";
    default:
      return "neutral";
  }
}

export function describeEmotionStatus(emotion: CharacterEmotion): string {
  return {
    neutral: "на связи",
    happy: "в хорошем настроении",
    amused: "развеселена",
    annoyed: "не впечатлена",
    curious: "заинтересована",
    empathetic: "сочувствует",
    blush: "смущается",
    bored: "скучает",
    calm: "спокойна",
    surprised: "удивлена",
    sad: "грустная",
    sleepy: "сонная",
    excited: "оживлена",
    pensive: "задумалась",
    worried: "беспокоится",
    proud: "гордится",
    shy: "стесняется",
    determined: "собрана",
  }[emotion];
}

export function emotionSettleTarget(
  emotion: CharacterEmotion,
  irritation: number,
): CharacterEmotion {
  if (emotion === "annoyed" && irritation > 0.25) {
    return "annoyed";
  }

  const targets: Partial<Record<CharacterEmotion, CharacterEmotion>> = {
    happy: "calm",
    excited: "happy",
    amused: "happy",
    surprised: "curious",
    curious: "neutral",
    empathetic: "calm",
    blush: "calm",
    shy: "blush",
    annoyed: irritation > 0.15 ? "annoyed" : "neutral",
    bored: "neutral",
    sleepy: "bored",
    calm: "neutral",
    sad: "calm",
    worried: "empathetic",
    pensive: "neutral",
    proud: "happy",
    determined: "calm",
  };

  return targets[emotion] ?? "neutral";
}
