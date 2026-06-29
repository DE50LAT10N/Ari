import type { AttentionState } from "./attention";
import { attentionStatusLabel } from "./attention";
import type { LifecycleState } from "./lifecycle";
import type { CharacterEmotion } from "../types/character";
import { describeEmotionStatus } from "./emotionPresentation";

export function lifecycleStatusLabel(state: LifecycleState): string | null {
  if (state === "awake" || state === "observing") {
    return null;
  }
  return {
    quiet: "тихий режим",
    sleepy: "сонная",
    sleeping: "спит",
    dnd: "не отвлекать",
  }[state];
}

export function buildLiveStatusLine({
  attention,
  lifecycle,
  emotion,
  loading,
  hasStreamTokens,
}: {
  attention: AttentionState;
  lifecycle: LifecycleState;
  emotion: CharacterEmotion;
  loading: boolean;
  hasStreamTokens: boolean;
}): string {
  if (loading) {
    return hasStreamTokens ? "печатает…" : "думает…";
  }

  const lifecycleLabel = lifecycleStatusLabel(lifecycle);
  if (lifecycleLabel) {
    return lifecycleLabel;
  }

  if (attention === "focused" || attention === "listening") {
    return attentionStatusLabel(attention);
  }

  if (attention === "observing" || attention === "waiting" || attention === "daydreaming") {
    return `${attentionStatusLabel(attention)} · ${describeEmotionStatus(emotion)}`;
  }

  return describeEmotionStatus(emotion);
}
