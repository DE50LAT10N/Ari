import type { CharacterMood } from "./mood";
import type { CharacterState } from "../types/character";
import { CHAT_TYPING_IDLE_SECONDS } from "../platform/userActivity";

export type AttentionState =
  | "focused"
  | "listening"
  | "observing"
  | "waiting"
  | "daydreaming"
  | "sleepy";

export function deriveAttentionState({
  characterState,
  chatOpen,
  idleSeconds,
  mood,
}: {
  characterState: CharacterState;
  chatOpen: boolean;
  idleSeconds: number;
  mood: CharacterMood;
}): AttentionState {
  if (characterState === "thinking" || characterState === "speaking") {
    return "focused";
  }
  if (chatOpen) {
    if (idleSeconds >= 8 * 60) return "daydreaming";
    if (idleSeconds >= CHAT_TYPING_IDLE_SECONDS) return "waiting";
    return "listening";
  }

  const hour = new Date().getHours();
  if ((hour >= 0 && hour < 6) || mood.energy < 0.2) return "sleepy";
  if (idleSeconds > 20 * 60) return "daydreaming";
  if (idleSeconds > 3 * 60) return "waiting";
  return "observing";
}

export function describeAttention(state: AttentionState): string {
  return {
    focused: "полностью сосредоточена на текущем ответе",
    listening: "внимательно слушает пользователя и ждёт продолжения",
    observing: "спокойно наблюдает за происходящим рядом",
    waiting: "ждёт возвращения внимания пользователя, не торопит его",
    daydreaming: "ненадолго ушла в свои мысли и не стремится немедленно вмешиваться",
    sleepy: "тихая и немного сонная, реагирует мягче обычного",
  }[state];
}

export function attentionStatusLabel(state: AttentionState): string {
  return {
    focused: "сосредоточена…",
    listening: "слушает",
    observing: "наблюдает",
    waiting: "ждёт",
    daydreaming: "задумалась",
    sleepy: "сонная",
  }[state];
}
