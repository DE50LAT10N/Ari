import type { CharacterEmotion } from "../types/character";
import type { MicroReactionType, PresenceScene } from "./presence";

export type SilentReactionKind =
  | "return"
  | "long_silence"
  | "coding_context"
  | "build_success"
  | "build_failed"
  | "error_detected"
  | "startup"
  | "repeated_click"
  | "ambient";

export type SilentReaction = {
  emotion: CharacterEmotion;
  overlay?: MicroReactionType;
  thought?: string;
  durationMs: number;
  cooldownMs: number;
};

const lastTriggered = new Map<SilentReactionKind, number>();

const definitions: Record<SilentReactionKind, SilentReaction[]> = {
  return: [
    { emotion: "curious", overlay: "thinking", thought: "*делает вид, что не ждала*", durationMs: 2800, cooldownMs: 10 * 60_000 },
    { emotion: "shy", overlay: "heart", thought: "*снова здесь — ок*", durationMs: 2800, cooldownMs: 10 * 60_000 },
    { emotion: "blush", overlay: "heart", thought: "*не смотри так, я же заметила*", durationMs: 2600, cooldownMs: 10 * 60_000 },
  ],
  long_silence: [
    { emotion: "bored", overlay: "thinking", thought: "*считает пиксели*", durationMs: 3200, cooldownMs: 15 * 60_000 },
    { emotion: "pensive", overlay: "thinking", thought: "*тишина затягивается*", durationMs: 3000, cooldownMs: 15 * 60_000 },
    { emotion: "sleepy", overlay: "thinking", thought: "*зевает в сторону*", durationMs: 3000, cooldownMs: 15 * 60_000 },
    { emotion: "sad", overlay: "heart", thought: "*как будто разговор ушёл в тень*", durationMs: 3200, cooldownMs: 15 * 60_000 },
  ],
  coding_context: [
    { emotion: "curious", overlay: "question", thought: "*заглядывает в код*", durationMs: 2600, cooldownMs: 8 * 60_000 },
    { emotion: "determined", overlay: "thinking", thought: "*собралась, смотрит в файл*", durationMs: 2600, cooldownMs: 8 * 60_000 },
    { emotion: "worried", overlay: "thinking", thought: "*что-то тут выглядит хрупко*", durationMs: 2800, cooldownMs: 8 * 60_000 },
  ],
  build_success: [
    { emotion: "happy", overlay: "sparkles", thought: "*довольно кивает*", durationMs: 2800, cooldownMs: 20 * 60_000 },
    { emotion: "proud", overlay: "sparkles", thought: "*ну вот, собралось*", durationMs: 2800, cooldownMs: 20 * 60_000 },
    { emotion: "excited", overlay: "sparkles", thought: "*зелёная сборка — приятно*", durationMs: 2600, cooldownMs: 20 * 60_000 },
  ],
  build_failed: [
    { emotion: "surprised", overlay: "surprise", thought: "*вижу failed в заголовке*", durationMs: 3000, cooldownMs: 12 * 60_000 },
    { emotion: "worried", overlay: "thinking", thought: "*сборка снова упала*", durationMs: 2800, cooldownMs: 12 * 60_000 },
    { emotion: "curious", overlay: "question", thought: "*похоже, сборка упала*", durationMs: 2800, cooldownMs: 12 * 60_000 },
  ],
  error_detected: [
    { emotion: "surprised", overlay: "surprise", thought: "*заметила что-то нехорошее*", durationMs: 2600, cooldownMs: 10 * 60_000 },
    { emotion: "worried", overlay: "thinking", thought: "*ошибка где-то рядом*", durationMs: 2600, cooldownMs: 10 * 60_000 },
  ],
  startup: [
    { emotion: "curious", overlay: "question", thought: "*осматривается после запуска*", durationMs: 2400, cooldownMs: 8 * 60 * 60_000 },
    { emotion: "sleepy", overlay: "thinking", thought: "*просыпается медленно*", durationMs: 2400, cooldownMs: 8 * 60 * 60_000 },
  ],
  repeated_click: [
    { emotion: "annoyed", overlay: "anger", thought: "*смотрит очень выразительно*", durationMs: 2400, cooldownMs: 60_000 },
    { emotion: "amused", overlay: "sparkles", thought: "*ладно, это было настойчиво*", durationMs: 2400, cooldownMs: 60_000 },
    { emotion: "determined", overlay: "thinking", thought: "*ладно, я поняла, ты здесь*", durationMs: 2400, cooldownMs: 60_000 },
  ],
  ambient: [
    { emotion: "amused", overlay: "sparkles", thought: "*тихо радуется*", durationMs: 2400, cooldownMs: 5 * 60_000 },
    { emotion: "curious", overlay: "question", thought: "*переоценивает твой план*", durationMs: 2600, cooldownMs: 5 * 60_000 },
    { emotion: "calm", overlay: "thinking", thought: "*просто рядом*", durationMs: 2400, cooldownMs: 5 * 60_000 },
    { emotion: "empathetic", overlay: "heart", thought: "*мягко на твоей стороне*", durationMs: 2600, cooldownMs: 5 * 60_000 },
    { emotion: "excited", overlay: "sparkles", thought: "*что-то её зацепило*", durationMs: 2400, cooldownMs: 5 * 60_000 },
    { emotion: "proud", overlay: "sparkles", thought: "*гордится твоим темпом*", durationMs: 2600, cooldownMs: 5 * 60_000 },
    { emotion: "shy", overlay: "heart", thought: "*чуть стесняется внимания*", durationMs: 2400, cooldownMs: 5 * 60_000 },
    { emotion: "blush", overlay: "heart", thought: "*тепло от комплимента в воздухе*", durationMs: 2400, cooldownMs: 5 * 60_000 },
    { emotion: "pensive", overlay: "thinking", thought: "*крутит мысль в голове*", durationMs: 2600, cooldownMs: 5 * 60_000 },
    { emotion: "bored", overlay: "thinking", thought: "*ждёт, чем займёшься*", durationMs: 2400, cooldownMs: 5 * 60_000 },
  ],
};

export function listSilentReactionEmotions(): CharacterEmotion[] {
  const seen = new Set<CharacterEmotion>();
  for (const options of Object.values(definitions)) {
    for (const entry of options) {
      seen.add(entry.emotion);
    }
  }
  return [...seen];
}

export function getSilentReaction(
  kind: SilentReactionKind,
  scene?: PresenceScene,
): SilentReaction | null {
  const options = definitions[kind];
  const cooldown = options[0].cooldownMs;
  const last = lastTriggered.get(kind) ?? 0;
  if (Date.now() - last < cooldown) return null;
  if (kind === "ambient" && (scene === "away" || scene === "night")) return null;
  lastTriggered.set(kind, Date.now());
  return options[Math.floor(Math.random() * options.length)];
}
