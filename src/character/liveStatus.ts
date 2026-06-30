import type { AttentionState } from "./attention";
import { attentionStatusLabel } from "./attention";
import type { LifecycleState } from "./lifecycle";
import type { CharacterEmotion } from "../types/character";
import type { CharacterMood } from "./mood";
import { moodStatusLabel } from "./moodBehavior";
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
  mood,
}: {
  attention: AttentionState;
  lifecycle: LifecycleState;
  emotion: CharacterEmotion;
  loading: boolean;
  hasStreamTokens: boolean;
  mood?: CharacterMood;
}): string {
  if (loading) {
    const base = hasStreamTokens ? "печатает…" : "думает…";
    return mood ? `${base} · ${moodStatusLabel(mood)}` : base;
  }

  const lifecycleLabel = lifecycleStatusLabel(lifecycle);
  if (lifecycleLabel) {
    return mood ? `${lifecycleLabel} · ${moodStatusLabel(mood)}` : lifecycleLabel;
  }

  const moodSuffix = mood ? ` · ${moodStatusLabel(mood)}` : "";

  if (attention === "focused" || attention === "listening") {
    return `${attentionStatusLabel(attention)}${moodSuffix}`;
  }

  if (attention === "observing" || attention === "waiting" || attention === "daydreaming") {
    const emotionLabel = describeEmotionStatus(emotion);
    if (mood) {
      return `${attentionStatusLabel(attention)} · ${moodStatusLabel(mood)}`;
    }
    return `${attentionStatusLabel(attention)} · ${emotionLabel}`;
  }

  if (mood) {
    return `${describeEmotionStatus(emotion)} · ${moodStatusLabel(mood)}`;
  }

  return describeEmotionStatus(emotion);
}
