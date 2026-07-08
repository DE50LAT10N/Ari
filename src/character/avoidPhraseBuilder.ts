import { getRecentPhrases } from "./phraseMemory";
import { getDislikedReplyExcerpts } from "./reactionLearning";
import { loadAriSelfMemory } from "./selfMemory";
import { getRecentProactiveTopics } from "./proactiveState";
import { getNegativeAdviceFeedbackExcerpts } from "./adviceLedger";

const CATEGORY_WEIGHT: Record<string, number> = {
  initiative: 5,
  shutdown: 4,
  tease: 3,
  greeting: 2,
  care: 2,
};

export function buildAvoidPhrases(limit = 10): string[] {
  const ranked = new Map<string, number>();

  for (const phrase of getRecentPhrases(limit)) {
    const weight =
      (CATEGORY_WEIGHT[phrase.category] ?? 1) +
      Math.min(phrase.count, 3) +
      (phrase.category === "initiative" ? 2 : 0);
    ranked.set(
      phrase.originalPhrase,
      Math.max(ranked.get(phrase.originalPhrase) ?? 0, weight),
    );
  }

  const selfMemory = loadAriSelfMemory();
  for (const joke of selfMemory.repeatedJokesToAvoid.slice(-6)) {
    ranked.set(joke, Math.max(ranked.get(joke) ?? 0, 4));
  }
  for (const dislike of selfMemory.userDislikedBehaviors.slice(-3)) {
    ranked.set(dislike.slice(0, 100), Math.max(ranked.get(dislike.slice(0, 100)) ?? 0, 5));
  }

  for (const excerpt of getDislikedReplyExcerpts(4)) {
    ranked.set(excerpt.slice(0, 120), Math.max(ranked.get(excerpt.slice(0, 120)) ?? 0, 6));
  }

  for (const excerpt of getNegativeAdviceFeedbackExcerpts(4)) {
    ranked.set(excerpt.slice(0, 120), Math.max(ranked.get(excerpt.slice(0, 120)) ?? 0, 6));
  }

  for (const topic of getRecentProactiveTopics().slice(0, 4)) {
    ranked.set(topic.slice(0, 120), Math.max(ranked.get(topic.slice(0, 120)) ?? 0, 3));
  }

  return [...ranked.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([phrase]) => phrase);
}
