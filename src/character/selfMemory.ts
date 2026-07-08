import type { CharacterEmotion } from "../types/character";
import type { MessageReaction } from "./messageReactions";
import { reactionSentiment } from "./messageReactions";

export type PreferredTone = "soft" | "playful" | "technical" | "quiet";

export type AriSelfMemory = {
  repeatedJokesToAvoid: string[];
  userPreferredTone: PreferredTone;
  userDislikedBehaviors: string[];
  successfulInteractionPatterns: string[];
  updatedAt: number;
};

const KEY = "desktop-character.ari-self-memory.v1";
let selfMemoryCache: AriSelfMemory | null = null;

const initial: AriSelfMemory = {
  repeatedJokesToAvoid: [],
  userPreferredTone: "playful",
  userDislikedBehaviors: [],
  successfulInteractionPatterns: [],
  updatedAt: Date.now(),
};

export function loadAriSelfMemory(): AriSelfMemory {
  if (selfMemoryCache) {
    return selfMemoryCache;
  }
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<AriSelfMemory> | null;
    selfMemoryCache = stored
      ? {
          repeatedJokesToAvoid: (stored.repeatedJokesToAvoid ?? []).slice(-20),
          userPreferredTone: stored.userPreferredTone ?? "playful",
          userDislikedBehaviors: (stored.userDislikedBehaviors ?? []).slice(-12),
          successfulInteractionPatterns: (stored.successfulInteractionPatterns ?? []).slice(-12),
          updatedAt: stored.updatedAt ?? Date.now(),
        }
      : initial;
    return selfMemoryCache;
  } catch {
    selfMemoryCache = initial;
    return selfMemoryCache;
  }
}

function save(memory: AriSelfMemory): AriSelfMemory {
  const stable = { ...memory, updatedAt: Date.now() };
  selfMemoryCache = stable;
  localStorage.setItem(KEY, JSON.stringify(stable));
  return stable;
}

function compactReply(reply: string): string {
  return reply.replace(/\s+/g, " ").trim().slice(0, 140);
}

export function updateAriSelfMemory(
  current: AriSelfMemory,
  userMessage: string,
  assistantReply: string,
  emotion: CharacterEmotion,
): AriSelfMemory {
  const user = userMessage.toLowerCase();
  let preferredTone = current.userPreferredTone;
  if (/(без шуток|серьезн|серьёзн|по делу|технически)/i.test(user)) preferredTone = "technical";
  else if (/(помягче|нежнее|спокойнее)/i.test(user)) preferredTone = "soft";
  else if (/(помолчи|короче|не пиши много|тише)/i.test(user)) preferredTone = "quiet";
  else if (/(шути|подкалывай|веселее)/i.test(user)) preferredTone = "playful";

  const disliked = [...current.userDislikedBehaviors];
  if (/(не называй|не делай|не надо|перестань|раздражает)/i.test(user)) {
    disliked.push(userMessage.trim().slice(0, 180));
  }

  const successful = [...current.successfulInteractionPatterns];
  if (/(спасибо|идеально|хорошо|нравится|отлично|так лучше)/i.test(user)) {
    successful.push(
      `${preferredTone} tone; emotion ${emotion}; ${compactReply(assistantReply)}`,
    );
  }

  const jokes = [...current.repeatedJokesToAvoid];
  if (
    (emotion === "amused" || emotion === "happy") &&
    assistantReply.length < 220
  ) {
    jokes.push(compactReply(assistantReply));
  }

  return save({
    repeatedJokesToAvoid: [...new Set(jokes)].slice(-20),
    userPreferredTone: preferredTone,
    userDislikedBehaviors: [...new Set(disliked)].slice(-12),
    successfulInteractionPatterns: [...new Set(successful)].slice(-12),
    updatedAt: Date.now(),
  });
}

export function applyReactionToSelfMemory(
  current: AriSelfMemory,
  emoji: MessageReaction,
  reply: string,
  emotion: CharacterEmotion = "neutral",
): AriSelfMemory {
  const excerpt = compactReply(reply);
  if (!excerpt) {
    return current;
  }

  const sentiment = reactionSentiment(emoji);
  const successful = [...current.successfulInteractionPatterns];
  const disliked = [...current.userDislikedBehaviors];
  let preferredTone = current.userPreferredTone;

  if (sentiment === "positive") {
    if (emoji === "😂") {
      preferredTone = "playful";
    }
    successful.push(`${emoji} ${emotion}; ${excerpt}`);
  } else if (sentiment === "negative") {
    disliked.push(`${emoji}: ${excerpt}`);
    if (/(?:хочешь|обсудим|продолжим|могу помочь|что думаешь)/iu.test(reply)) {
      disliked.push("не заканчивать реплики вопросом или приглашением продолжить");
    }
  } else if (sentiment === "sad") {
    preferredTone = "soft";
    successful.push(`эмпатия ${emotion}; ${excerpt}`);
  } else if (sentiment === "surprise") {
    successful.push(`неожиданное ${emotion}; ${excerpt}`);
  }

  return save({
    ...current,
    userPreferredTone: preferredTone,
    userDislikedBehaviors: [...new Set(disliked)].slice(-12),
    successfulInteractionPatterns: [...new Set(successful)].slice(-12),
    updatedAt: Date.now(),
  });
}

export function resetSelfMemoryForTests(): void {
  selfMemoryCache = null;
  localStorage.removeItem(KEY);
}

export function describeAriSelfMemory(memory: AriSelfMemory): string {
  const parts = [`предпочтительный тон: ${memory.userPreferredTone}`];
  if (memory.userDislikedBehaviors.length) {
    parts.push(`избегать: ${memory.userDislikedBehaviors.slice(-4).join("; ")}`);
  }
  if (memory.successfulInteractionPatterns.length) {
    parts.push(`удачные паттерны: ${memory.successfulInteractionPatterns.slice(-3).join("; ")}`);
  }
  if (memory.repeatedJokesToAvoid.length) {
    parts.push(`не повторять реплики: ${memory.repeatedJokesToAvoid.slice(-5).join(" | ")}`);
  }
  return parts.join(". ");
}
