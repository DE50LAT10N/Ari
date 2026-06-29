import type { CharacterEmotion } from "../types/character";

type EmotionTransitionRule = {
  canGoTo: CharacterEmotion[];
  avoidDirectTo?: CharacterEmotion[];
  bridge?: CharacterEmotion;
  settleAfterMs: number;
};

const allExcept = (...skip: CharacterEmotion[]): CharacterEmotion[] =>
  (
    [
      "neutral",
      "happy",
      "amused",
      "annoyed",
      "curious",
      "empathetic",
      "blush",
      "bored",
      "calm",
      "surprised",
      "sad",
      "sleepy",
      "excited",
      "pensive",
      "worried",
      "proud",
      "shy",
      "determined",
    ] as CharacterEmotion[]
  ).filter((emotion) => !skip.includes(emotion));

export const emotionTransitions: Record<
  CharacterEmotion,
  EmotionTransitionRule
> = {
  neutral: {
    canGoTo: allExcept(),
    settleAfterMs: 55_000,
  },
  happy: {
    canGoTo: allExcept("annoyed", "sad"),
    avoidDirectTo: ["annoyed", "sad"],
    bridge: "curious",
    settleAfterMs: 28_000,
  },
  amused: {
    canGoTo: allExcept("annoyed", "sad", "worried"),
    avoidDirectTo: ["annoyed", "sad"],
    bridge: "happy",
    settleAfterMs: 24_000,
  },
  annoyed: {
    canGoTo: allExcept("happy", "blush", "excited", "proud"),
    avoidDirectTo: ["happy", "blush", "excited", "proud"],
    bridge: "curious",
    settleAfterMs: 32_000,
  },
  curious: {
    canGoTo: allExcept("annoyed"),
    settleAfterMs: 26_000,
  },
  empathetic: {
    canGoTo: allExcept("annoyed", "excited"),
    avoidDirectTo: ["annoyed", "excited"],
    bridge: "calm",
    settleAfterMs: 34_000,
  },
  blush: {
    canGoTo: allExcept("annoyed", "sad", "determined"),
    avoidDirectTo: ["annoyed"],
    bridge: "calm",
    settleAfterMs: 30_000,
  },
  bored: {
    canGoTo: allExcept("excited", "proud"),
    bridge: "curious",
    settleAfterMs: 45_000,
  },
  calm: {
    canGoTo: allExcept("annoyed", "excited"),
    settleAfterMs: 40_000,
  },
  surprised: {
    canGoTo: allExcept("sleepy", "bored"),
    bridge: "curious",
    settleAfterMs: 16_000,
  },
  sad: {
    canGoTo: ["empathetic", "calm", "neutral", "worried", "pensive", "curious", "sad"],
    avoidDirectTo: ["happy", "excited", "amused", "proud"],
    bridge: "calm",
    settleAfterMs: 38_000,
  },
  sleepy: {
    canGoTo: ["bored", "calm", "neutral", "pensive", "sleepy"],
    avoidDirectTo: ["excited", "surprised", "happy"],
    bridge: "calm",
    settleAfterMs: 50_000,
  },
  excited: {
    canGoTo: ["happy", "amused", "curious", "surprised", "proud", "excited"],
    avoidDirectTo: ["bored", "sleepy", "sad"],
    bridge: "happy",
    settleAfterMs: 20_000,
  },
  pensive: {
    canGoTo: ["curious", "calm", "neutral", "worried", "determined", "pensive"],
    avoidDirectTo: ["excited", "amused"],
    bridge: "curious",
    settleAfterMs: 32_000,
  },
  worried: {
    canGoTo: ["empathetic", "calm", "pensive", "sad", "neutral", "worried"],
    avoidDirectTo: ["happy", "excited", "amused"],
    bridge: "empathetic",
    settleAfterMs: 36_000,
  },
  proud: {
    canGoTo: ["happy", "excited", "calm", "blush", "shy", "proud"],
    avoidDirectTo: ["annoyed", "sad"],
    bridge: "happy",
    settleAfterMs: 26_000,
  },
  shy: {
    canGoTo: ["blush", "calm", "happy", "neutral", "shy"],
    avoidDirectTo: ["annoyed", "excited"],
    bridge: "blush",
    settleAfterMs: 28_000,
  },
  determined: {
    canGoTo: ["curious", "calm", "neutral", "proud", "determined"],
    avoidDirectTo: ["bored", "sleepy", "amused"],
    bridge: "curious",
    settleAfterMs: 30_000,
  },
};

export function emotionTransitionPath(
  from: CharacterEmotion,
  to: CharacterEmotion,
): CharacterEmotion[] {
  if (from === to) return [to];
  if (from === "neutral") return [to];

  const rule = emotionTransitions[from];
  if (rule.canGoTo.includes(to)) return [to];
  if (rule.avoidDirectTo?.includes(to) && rule.bridge) {
    return rule.bridge === to ? [to] : [rule.bridge, to];
  }
  if (to !== "neutral") {
    return ["curious", to];
  }
  return [to];
}

const SETTLE_DELAY_SCALE = 1.75;

export function emotionSettleDelay(emotion: CharacterEmotion): number {
  return Math.round(emotionTransitions[emotion].settleAfterMs * SETTLE_DELAY_SCALE);
}

export const EMOTION_BRIDGE_MS = 650;
