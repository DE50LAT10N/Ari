import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { CharacterMood } from "./mood";
import { moodPreferredEmotion } from "./mood";
import type { AttentionState } from "./attention";
import type { CharacterEmotion } from "../types/character";
import { emotionSettleTarget } from "./emotionPresentation";

export type PresenceScene =
  | "morning"
  | "focus"
  | "break"
  | "evening"
  | "night"
  | "away";

export type MicroReactionType =
  | "question"
  | "surprise"
  | "heart"
  | "anger"
  | "sparkles"
  | "thinking";

export type MicroReaction = {
  id: number;
  type: MicroReactionType;
  emotion?: CharacterEmotion;
  thought?: string;
  durationMs?: number;
};

export function derivePresenceScene({
  attention,
  activeWindow,
  idleSeconds,
}: {
  attention: AttentionState;
  activeWindow: ActiveWindowInfo | null;
  idleSeconds: number;
}): PresenceScene {
  const hour = new Date().getHours();
  if (idleSeconds >= 20 * 60 || attention === "daydreaming") return "away";
  if (idleSeconds >= 3 * 60 || attention === "waiting") return "break";
  if (hour < 6 || hour >= 23) return "night";
  if (hour < 11) return "morning";
  if (hour >= 19) return "evening";
  return activeWindow ? "focus" : "break";
}

export function describePresenceScene(scene: PresenceScene): string {
  return {
    morning: "начало дня: чуть свежее и мягче обычного",
    focus: "рабочий ритм: не отвлекает без причины и говорит собраннее",
    break: "короткая пауза: расслабленнее и допускает лёгкую бытовую реакцию",
    evening: "вечер: становится спокойнее и теплее",
    night: "глубокая ночь: тихая, медленная и ненавязчивая",
    away: "пользователь отошёл: Ari занята своими мыслями и не требует внимания",
  }[scene];
}

export function settlingEmotion(
  emotion: CharacterEmotion,
  mood: CharacterMood,
  scene: PresenceScene,
): CharacterEmotion {
  const preferred = moodPreferredEmotion(mood);
  if (scene === "away" || mood.energy < 0.2) {
    return preferred ?? "bored";
  }
  const settled = emotionSettleTarget(emotion, mood.irritation);
  if (settled === "neutral" && preferred) {
    return preferred;
  }
  return settled;
}

export function microReactionTypeForEmotion(
  emotion: CharacterEmotion,
): MicroReactionType {
  const map: Partial<Record<CharacterEmotion, MicroReactionType>> = {
    happy: "sparkles",
    excited: "sparkles",
    amused: "sparkles",
    annoyed: "anger",
    empathetic: "heart",
    blush: "heart",
    shy: "heart",
    curious: "question",
    surprised: "surprise",
    worried: "thinking",
    pensive: "thinking",
    sad: "heart",
    proud: "sparkles",
    determined: "thinking",
    calm: "thinking",
    bored: "thinking",
    sleepy: "thinking",
  };
  return map[emotion] ?? "thinking";
}

function microReactionThought(
  mood: CharacterMood,
  scene: PresenceScene,
  activeWindow: ActiveWindowInfo | null,
): string | undefined {
  const archetype =
    mood.irritation > 0.38
      ? "irritated"
      : mood.warmth > 0.52
        ? "warm"
        : mood.energy < 0.3
          ? "sleepy"
          : "observant";
  const windowBit = activeWindow?.title
    ? activeWindow.title.split(/[-—|]/)[0]?.trim().slice(0, 40)
    : undefined;
  const thoughts: Record<string, string[]> = {
    irritated: [
      "Тишина слишком долгая — не буду лезть с советами.",
      "Лучше помолчу, чем снова читать лекцию.",
    ],
    warm: [
      windowBit ? `Интересно, что там в ${windowBit}…` : "Тихо. Может, просто рядом.",
      "Похоже, человек в потоке — не мешаю.",
    ],
    sleepy: ["*зевает* …ещё немного тишины.", "Ночь тянется."],
    observant: [
      windowBit ? `В ${windowBit} что-то происходит.` : "Тишина не всегда плоха.",
      scene === "focus" ? "Рабочий ритм." : "Момент для наблюдения.",
    ],
  };
  const pool = thoughts[archetype] ?? thoughts.observant;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function chooseMicroReaction({
  scene,
  mood,
  activeWindow,
}: {
  scene: PresenceScene;
  mood: CharacterMood;
  activeWindow: ActiveWindowInfo | null;
}): MicroReaction {
  const random = Math.random();
  const preferred = moodPreferredEmotion(mood);
  if (preferred && random < 0.38) {
    return {
      id: Date.now(),
      type: microReactionTypeForEmotion(preferred),
      emotion: preferred,
      thought: microReactionThought(mood, scene, activeWindow),
    };
  }

  if (mood.irritation > 0.45) {
    return {
      id: Date.now(),
      type: "anger",
      emotion: "annoyed",
      thought: microReactionThought(mood, scene, activeWindow),
    };
  }
  if (mood.irritation > 0.22 && mood.irritation <= 0.45 && random < 0.34) {
    return {
      id: Date.now(),
      type: random > 0.5 ? "thinking" : "anger",
      emotion: random > 0.5 ? "worried" : "determined",
      thought: microReactionThought(mood, scene, activeWindow),
    };
  }
  if (mood.warmth > 0.58 && mood.energy < 0.42 && random < 0.32) {
    return {
      id: Date.now(),
      type: "heart",
      emotion: random > 0.5 ? "shy" : "blush",
      thought: microReactionThought(mood, scene, activeWindow),
    };
  }
  if (mood.warmth > 0.5 && mood.energy > 0.52 && random < 0.28) {
    return {
      id: Date.now(),
      type: "sparkles",
      emotion: random > 0.45 ? "proud" : "happy",
      thought: microReactionThought(mood, scene, activeWindow),
    };
  }
  if (mood.energy > 0.62 && random < 0.35) {
    return { id: Date.now(), type: "sparkles", emotion: "excited" };
  }
  if (mood.warmth < 0.2 && random < 0.3) {
    return {
      id: Date.now(),
      type: "thinking",
      emotion: random > 0.5 ? "pensive" : "sad",
    };
  }
  if (scene === "morning" && mood.warmth > 0.45) {
    return { id: Date.now(), type: "sparkles", emotion: "happy" };
  }
  if (scene === "evening" || scene === "night") {
    return {
      id: Date.now(),
      type: random > 0.65 ? "heart" : "thinking",
      emotion: random > 0.65 ? "empathetic" : "bored",
    };
  }
  if (scene === "focus" && activeWindow) {
    return {
      id: Date.now(),
      type: random > 0.55 ? "question" : "thinking",
      emotion: "curious",
    };
  }
  return {
    id: Date.now(),
    type: random > 0.5 ? "sparkles" : "question",
    emotion: random > 0.5 ? "amused" : "curious",
    thought: microReactionThought(mood, scene, activeWindow),
  };
}
