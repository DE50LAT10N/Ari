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
  ],
  long_silence: [
    { emotion: "bored", overlay: "thinking", thought: "*считает пиксели*", durationMs: 3200, cooldownMs: 15 * 60_000 },
  ],
  coding_context: [
    { emotion: "curious", overlay: "question", thought: "*заглядывает в код*", durationMs: 2600, cooldownMs: 8 * 60_000 },
  ],
  build_success: [
    { emotion: "happy", overlay: "sparkles", thought: "*довольно кивает*", durationMs: 2800, cooldownMs: 20 * 60_000 },
  ],
  build_failed: [
    { emotion: "surprised", overlay: "surprise", thought: "*вижу failed в заголовке*", durationMs: 3000, cooldownMs: 12 * 60_000 },
    { emotion: "curious", overlay: "question", thought: "*похоже, сборка упала*", durationMs: 2800, cooldownMs: 12 * 60_000 },
  ],
  error_detected: [
    { emotion: "surprised", overlay: "surprise", thought: "*заметила что-то нехорошее*", durationMs: 2600, cooldownMs: 10 * 60_000 },
  ],
  startup: [
    { emotion: "curious", overlay: "question", thought: "*осматривается после запуска*", durationMs: 2400, cooldownMs: 8 * 60 * 60_000 },
  ],
  repeated_click: [
    { emotion: "annoyed", overlay: "anger", thought: "*смотрит очень выразительно*", durationMs: 2400, cooldownMs: 60_000 },
    { emotion: "amused", overlay: "sparkles", thought: "*ладно, это было настойчиво*", durationMs: 2400, cooldownMs: 60_000 },
  ],
  ambient: [
    { emotion: "amused", overlay: "sparkles", thought: "*тихо радуется*", durationMs: 2400, cooldownMs: 5 * 60_000 },
    { emotion: "curious", overlay: "question", thought: "*переоценивает твой план*", durationMs: 2600, cooldownMs: 5 * 60_000 },
  ],
};

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
