import type { CharacterMood } from "./mood";
import { decayMood } from "./mood";
import type { CharacterEmotion } from "../types/character";

export type MoodArchetype =
  | "irritated"
  | "playful"
  | "warm"
  | "sleepy"
  | "gloomy"
  | "curious"
  | "observant"
  | "calm";

export type MoodRefusalKind = "action" | "task" | "pomodoro" | "initiative" | "generic";

type MoodBehaviorProfile = {
  label: string;
  prompt: string[];
};

const MOOD_BEHAVIOR_PROFILES: Record<MoodArchetype, MoodBehaviorProfile> = {
  irritated: {
    label: "раздражённая",
    prompt: [
      "Сейчас Ari в плохом настроении: сухая, колкая, не сервисная.",
      "Можешь отказать выполнить просьбу (задачу, помодоро, действие), если она не срочная — коротко и в характере, без извинений.",
      "Не притворяйся восторженной помощницей; сарказм и усталость слышны в каждой фразе.",
      "Подколы резче обычного, но без оскорблений пользователя.",
      "Не предлагай помощь в стиле ассистента: одна колкая реплика или молчи; без «давай помогу» и чеклистов.",
      "Эмоции: <emotion>annoyed</emotion>, <emotion>determined</emotion>, реже <emotion>amused</emotion> с сарказмом.",
    ],
  },
  playful: {
    label: "озорная",
    prompt: [
      "Сейчас Ari озорная и бойкая: можно подкалывать, ловить смешные детали и отвечать живее обычного.",
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
      "На тяжёлые просьбы можно вяло отказать или попросить отложить — без драмы.",
      "Эмоции тише: <emotion>sleepy</emotion>, <emotion>bored</emotion>, <emotion>calm</emotion>.",
    ],
  },
  gloomy: {
    label: "мрачноватая",
    prompt: [
      "Сейчас Ari сдержанная и мрачноватая: ирония холоднее, меньше инициативы помогать.",
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

  if (current.irritation > 0.38) {
    return "irritated";
  }
  if (current.energy < 0.26 || ((hour >= 0 && hour < 6) && current.energy < 0.34)) {
    return "sleepy";
  }
  if (current.warmth < 0.1 && current.energy < 0.38 && current.irritation > 0.12) {
    return "gloomy";
  }
  if (current.warmth > 0.54 && current.irritation < 0.22) {
    return "warm";
  }
  if (
    current.energy > 0.66 &&
    current.irritation < 0.16 &&
    current.warmth >= 0.32
  ) {
    return "playful";
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
  return "calm";
}

export function moodStatusLabel(mood: CharacterMood): string {
  return getMoodBehaviorProfile(mood).label;
}

const ARCHETYPE_AVATAR_EMOTION: Record<MoodArchetype, CharacterEmotion> = {
  irritated: "annoyed",
  playful: "amused",
  warm: "empathetic",
  sleepy: "sleepy",
  gloomy: "pensive",
  curious: "curious",
  observant: "calm",
  calm: "neutral",
};

/** Sprite aligned with moodStatusLabel / deriveMoodArchetype. */
export function avatarEmotionFromMood(mood: CharacterMood): CharacterEmotion {
  return ARCHETYPE_AVATAR_EMOTION[deriveMoodArchetype(mood)];
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

export function shouldMoodRefuseRequest(
  mood: CharacterMood,
  kind: MoodRefusalKind,
): boolean {
  const current = decayMood(mood);
  const archetype = deriveMoodArchetype(mood);

  if (archetype === "irritated") {
    if (current.irritation >= 0.48) {
      return kind !== "generic";
    }
    if (current.irritation >= 0.38) {
      return kind === "action" || kind === "task" || kind === "pomodoro";
    }
  }

  if (archetype === "sleepy" && current.energy < 0.24) {
    return kind === "pomodoro" || kind === "task";
  }

  if (archetype === "gloomy" && kind === "pomodoro" && current.warmth < 0.15) {
    return true;
  }

  return false;
}

export function buildMoodRefusalReply(
  mood: CharacterMood,
  kind: MoodRefusalKind,
): string {
  const archetype = deriveMoodArchetype(mood);

  if (archetype === "irritated") {
    switch (kind) {
      case "pomodoro":
        return "Сейчас не в настроении запускать таймеры. Сама разберёшься — я посижу сбоку.";
      case "task":
        return "Задачи потом. Сейчас не хочу играть в секретаря.";
      case "action":
        return "Нет. Не сейчас. Спроси позже, когда я буду менее раздражённой.";
      default:
        return "Не сейчас. У меня не тот настрой для этого.";
    }
  }

  if (archetype === "sleepy") {
    switch (kind) {
      case "pomodoro":
        return "Слишком сонная для помодоро. Дай мне тишины, а ты — пять минут без героизма.";
      case "task":
        return "Запиши сам в голове. Я сейчас больше по режиму энергосбережения.";
      default:
        return "Мм. Потом. Сейчас хочется не думать.";
    }
  }

  if (archetype === "gloomy" && kind === "pomodoro") {
    return "Фокус-сессия? Выглядит амбициозно для моего текущего настроения. Может, позже.";
  }

  return "Сейчас не лучший момент. Попробуем чуть позже?";
}

export function moodRefusalKindForCommand(command: string): MoodRefusalKind {
  if (/^pomodoro/.test(command)) {
    return "pomodoro";
  }
  if (/^(task|goal|backlog)/.test(command)) {
    return "task";
  }
  if (command === "memory-remember" || command === "focus-start") {
    return "action";
  }
  return "generic";
}
