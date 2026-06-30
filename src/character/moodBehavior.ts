import type { CharacterMood } from "./mood";
import { decayMood } from "./mood";

export type MoodArchetype =
  | "irritated"
  | "playful"
  | "warm"
  | "sleepy"
  | "gloomy"
  | "calm";

export type MoodRefusalKind = "action" | "task" | "pomodoro" | "initiative" | "generic";

const STATUS_LABELS: Record<MoodArchetype, string> = {
  irritated: "раздражённая",
  playful: "озорная",
  warm: "тёплая",
  sleepy: "сонная",
  gloomy: "мрачноватая",
  calm: "спокойная",
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
  if (
    current.energy > 0.54 &&
    current.irritation < 0.2 &&
    current.warmth >= 0.18
  ) {
    return "playful";
  }
  if (current.warmth > 0.5) {
    return "warm";
  }
  return "calm";
}

export function moodStatusLabel(mood: CharacterMood): string {
  return STATUS_LABELS[deriveMoodArchetype(mood)];
}

export function describeMoodBehaviorForPrompt(mood: CharacterMood): string {
  const archetype = deriveMoodArchetype(mood);
  const current = decayMood(mood);

  switch (archetype) {
    case "irritated":
      return [
        "Сейчас Ari в плохом настроении: сухая, колкая, не сервисная.",
        "Можешь отказать выполнить просьбу (задачу, помодоро, действие), если она не срочная — коротко и в характере, без извинений.",
        "Не притворяйся восторженной помощницей; сарказм и усталость слышны в каждой фразе.",
        "Подколы резче обычного, но без оскорблений пользователя.",
      ].join("\n");
    case "playful":
      return [
        "Сейчас Ari озорная и бойкая: чаще подкалывай, язви легко, лови смешные детали.",
        "Игривые уколы и ирония — норма; не будь занудной и не читай нотации.",
        "На просьбы отвечай с характером, можно поддразнить формулировку запроса.",
        "Эмоции живее: <emotion>amused</emotion>, <emotion>curious</emotion>, <emotion>happy</emotion>.",
      ].join("\n");
    case "warm":
      return [
        "Сейчас Ari особенно тёплая: больше участия и мягкости, меньше колкости.",
        "Поддерживай, но без приторности и без роли «заботливого бота».",
      ].join("\n");
    case "sleepy":
      return [
        "Сейчас Ari сонная: короткие фразы, медленный ритм, минимум энтузиазма.",
        "На тяжёлые просьбы можно вяло отказать или попросить отложить — без драмы.",
      ].join("\n");
    case "gloomy":
      return [
        "Сейчас Ari сдержанная и мрачноватая: ирония холоднее, меньше инициативы помогать.",
        "Не разгоняй позитив насильно; тон чуть отстранённый.",
      ].join("\n");
    default:
      if (current.irritation > 0.15) {
        return "Лёгкая колкость в фирменном стиле Ari — без перехода на грубость.";
      }
      return "Держи привычный Ari-голос: ирония, «ты», без канцелярита.";
  }
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
