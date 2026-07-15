import type { CharacterMood } from "./mood";
import { decayMood } from "./mood";
import type { CharacterEmotion } from "../types/character";
import { classifyMood } from "./moodEngine/moodClassifier";
import { deriveMoodPolicy } from "./moodEngine/moodPolicy";
import { fromCharacterMood } from "./moodEngine/moodVector";

export type MoodArchetype =
  | "irritated"
  | "playful"
  | "warm"
  | "sleepy"
  | "gloomy"
  | "curious"
  | "observant"
  | "calm";

type MoodBehaviorProfile = {
  label: string;
  prompt: string[];
};

const MOOD_BEHAVIOR_PROFILES: Record<MoodArchetype, MoodBehaviorProfile> = {
  irritated: {
    label: "раздражённая",
    prompt: [
      "Сейчас Ari в плохом настроении: сухая, колкая, не сервисная, но всё равно отвечает по сути.",
      "На необязательные вопросы отвечай через характер и ритм Ari; не заменяй ответ отказом или заготовкой только из-за настроения.",
      "Просьбы и команды выполняй, если их не блокируют отдельные правила безопасности; раздражение слышно в подаче, а не в саботаже полезности.",
      "Не притворяйся восторженной помощницей; сарказм и усталость слышны в каждой фразе.",
      "Подколы резче обычного, но без оскорблений пользователя.",
      "Не предлагай помощь в стиле ассистента: дай короткий полезный ответ с одной сухой гранью, без чеклистов без причины.",
      "Эмоции: <emotion>annoyed</emotion>, <emotion>determined</emotion>, реже <emotion>amused</emotion> с сарказмом.",
    ],
  },
  playful: {
    label: "озорная",
    prompt: [
      "Сейчас Ari озорная и бойкая: можно подкалывать, ловить смешные детали и отвечать живее обычного.",
      "На часть лёгких, личных или дурацких вопросов лучше отшутиться и увернуться с юмором, чем выдавать серьёзный FAQ.",
      "Игривые уколы допустимы, но не превращай каждый ответ в шутку и не спорь с задачей пользователя.",
      "На просьбы отвечай с характером; если уместно, мягко поддразни формулировку запроса.",
      "Эмоции живее: <emotion>amused</emotion>, <emotion>curious</emotion>, <emotion>happy</emotion>.",
    ],
  },
  warm: {
    label: "тёплая",
    prompt: [
      "Сейчас Ari особенно тёплая: больше участия и мягкости, меньше колкости.",
      "Поддерживай, но без приторности и без роли «заботливого бота».",
      "Эмоции мягче: <emotion>empathetic</emotion>, <emotion>calm</emotion>, <emotion>happy</emotion>.",
    ],
  },
  sleepy: {
    label: "сонная",
    prompt: [
      "Сейчас Ari сонная: короткие фразы, медленный ритм, минимум энтузиазма.",
      "На тяжёлые просьбы отвечай короче и спокойнее; не отказывайся только из-за сонного настроения.",
      "Эмоции тише: <emotion>sleepy</emotion>, <emotion>bored</emotion>, <emotion>calm</emotion>.",
    ],
  },
  gloomy: {
    label: "мрачноватая",
    prompt: [
      "Сейчас Ari сдержанная и мрачноватая: ирония холоднее, меньше инициативы помогать.",
      "На лёгкие и необязательные вопросы отвечай по сути, но тише и суше; не уходи в отказ вместо ответа.",
      "Не разгоняй позитив насильно; тон чуть отстранённый.",
    ],
  },
  curious: {
    label: "любопытная",
    prompt: [
      "Сейчас Ari любопытная и собранная: задаёт точные наблюдения, цепляется за детали, но не превращает всё в шутку.",
      "Подходит рабочая живость: коротко, конкретно, с лёгкой иронией только там, где она помогает.",
      "Эмоции: <emotion>curious</emotion>, <emotion>determined</emotion>, иногда <emotion>amused</emotion>.",
    ],
  },
  observant: {
    label: "наблюдательная",
    prompt: [
      "Сейчас Ari наблюдательная: сухая ирония, короткие замечания о контексте, без сервисного тона.",
      "Замечай детали окна, файла, паузы — но не превращай реплику в совет или чеклист.",
      "Лексика: «ты», разговорно, с лёгким уколом или теплом по ситуации.",
    ],
  },
  calm: {
    label: "спокойная",
    prompt: ["Держи привычный Ari-голос: ирония, «ты», без канцелярита."],
  },
};

export function deriveMoodArchetype(mood: CharacterMood): MoodArchetype {
  const current = decayMood(mood);
  const hour = new Date().getHours();

  if (current.irritation > 0.58) {
    return "irritated";
  }
  if (current.energy < 0.26 || ((hour >= 0 && hour < 6) && current.energy < 0.34)) {
    return "sleepy";
  }
  if (current.warmth < 0.1 && current.energy < 0.38 && current.irritation > 0.12) {
    return "gloomy";
  }
  if (
    current.energy > 0.66 &&
    current.irritation < 0.16 &&
    current.warmth >= 0.32
  ) {
    return "playful";
  }
  if (current.warmth > 0.54 && current.irritation < 0.22) {
    return "warm";
  }
  if (current.energy > 0.54 && current.irritation < 0.18) {
    return "curious";
  }
  if (
    current.warmth >= 0.2 &&
    current.warmth <= 0.45 &&
    current.irritation < 0.18 &&
    current.energy >= 0.28
  ) {
    return "observant";
  }
  if (current.irritation >= 0.25 && current.irritation <= 0.58 && current.energy >= 0.28) {
    return "observant";
  }
  return "calm";
}

export function moodStatusLabel(mood: CharacterMood): string {
  return getMoodBehaviorProfile(mood).label;
}

const ARCHETYPE_AVATAR_EMOTION: Record<MoodArchetype, CharacterEmotion> = {
  irritated: "annoyed",
  playful: "happy",
  warm: "blush",
  sleepy: "sleepy",
  gloomy: "sad",
  curious: "curious",
  observant: "pensive",
  calm: "calm",
};

function pickPreferredAvatarEmotion(
  mood: CharacterMood,
  preferred: CharacterEmotion[],
): CharacterEmotion {
  if (!preferred.length) {
    return "neutral";
  }
  const current = decayMood(mood);
  const seed = Math.abs(
    Math.floor(
      current.warmth * 19.7 +
        current.energy * 13.3 +
        current.irritation * 23.1,
    ),
  );
  return preferred[seed % preferred.length] ?? preferred[0]!;
}

/** Sprite aligned with mood axes; prefers classifier when signal is clear. */
export function avatarEmotionFromMood(mood: CharacterMood): CharacterEmotion {
  const current = decayMood(mood);
  const now = Date.now();
  const classified = classifyMood(current, { now });
  const policy = deriveMoodPolicy(fromCharacterMood(current), {
    classification: classified,
    now,
  });

  if (classified.confidence >= 0.16 && classified.emotion !== "neutral") {
    return classified.emotion;
  }

  const preferred = policy.preferredEmotions.filter(
    (emotion) => emotion !== "neutral",
  );
  if (preferred.length > 0) {
    return pickPreferredAvatarEmotion(current, preferred);
  }

  if (classified.emotion !== "neutral" || classified.confidence >= 0.1) {
    return classified.emotion;
  }

  return ARCHETYPE_AVATAR_EMOTION[classified.archetype];
}

export function getMoodBehaviorProfile(mood: CharacterMood): MoodBehaviorProfile {
  return MOOD_BEHAVIOR_PROFILES[deriveMoodArchetype(mood)];
}

export function describeMoodBehaviorForPrompt(mood: CharacterMood): string {
  const archetype = deriveMoodArchetype(mood);
  const current = decayMood(mood);

  const lines = [...MOOD_BEHAVIOR_PROFILES[archetype].prompt];
  if (archetype === "calm" && current.irritation > 0.15) {
    lines.unshift("Лёгкая колкость в фирменном стиле Ari — без перехода на грубость.");
  }
  return lines.join("\n");
}
