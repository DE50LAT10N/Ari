import type { CharacterMood } from "../character/mood";
import { deriveMoodArchetype } from "../character/moodBehavior";
import type { ProactiveReplyTone } from "../character/proactiveTone";

export function chooseResponseLength(
  message: string,
  memoryMatches: number,
  proactive: boolean,
  proactiveReplyTone?: ProactiveReplyTone,
  mood?: CharacterMood,
  moodResponseParams?: {
    preferredReplyLength?: "short" | "normal" | "chatty";
    preferClarifyingTone?: boolean;
    sarcasm?: number;
    adviceAssertiveness?: number;
    questionBias?: number;
  },
): "short" | "medium" | "long" {
  if (mood && deriveMoodArchetype(mood) === "irritated") {
    return proactiveReplyTone === "advice" ? "short" : "short";
  }
  if (moodResponseParams?.preferredReplyLength === "short") {
    return "short";
  }
  if (proactive) {
    return proactiveReplyTone === "advice" ? "medium" : "short";
  }

  const normalized = message.toLowerCase();
  const asksForDetail =
    /(подроб|разв[её]рнут|объясни|проанализ|сравни|разбери|почему|как работает|по документ|по pdf|составь|реферат|эссе)/i.test(
      normalized,
    );
  if (asksForDetail || message.length > 260 || memoryMatches >= 3) {
    return "long";
  }
  if (
    message.length > 100 ||
    /(как |что такое|каким образом|помоги|расскажи|подскажи|объясни)/i.test(
      normalized,
    )
  ) {
    return "medium";
  }
  if (
    moodResponseParams?.preferredReplyLength === "chatty" &&
    !proactive &&
    message.length > 30
  ) {
    return "medium";
  }
  return "short";
}
