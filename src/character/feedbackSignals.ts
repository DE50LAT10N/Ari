import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion } from "../types/character";
import type { AdviceFeedback, AdviceLedgerEntry } from "./adviceLedger";
import { updateAdviceFeedback } from "./adviceLedger";
import { recordAdviceFeedbackOutcome } from "./adviceOutcome";
import type { MessageReaction } from "./messageReactions";
import {
  assistantIgnoredToMoodEvent,
  proactiveToMoodEvent,
  reactionToMoodEvent,
  type MoodEvent,
} from "./moodEngine";
import {
  recordReactionLearning,
  type ReactionLearningResult,
} from "./reactionLearning";
import { recordRelevanceFeedback } from "./relevanceRanker";
import {
  loadAriSelfMemory,
  updateAriSelfMemory,
  type AriSelfMemory,
} from "./selfMemory";

export type FeedbackSignal =
  | {
      kind: "message_reaction";
      emoji: MessageReaction;
      message: ChatMessage;
      timestamp?: number;
    }
  | {
      kind: "advice_feedback";
      adviceId: string;
      feedback: AdviceFeedback;
      source: "menu" | "reaction";
      message?: ChatMessage;
      timestamp?: number;
    }
  | {
      kind: "conversation_exchange";
      userMessage: string;
      assistantReply: string;
      emotion: CharacterEmotion;
      currentSelfMemory?: AriSelfMemory;
      timestamp?: number;
    }
  | {
      kind: "assistant_ignored";
      messageId: string;
      source: "chat" | "proactive" | "ambient";
      proactive: boolean;
      adviceId?: string;
      ageMs: number;
      ignoredStreak: number;
      timestamp?: number;
    };

export type FeedbackSignalResult = {
  selfMemory?: AriSelfMemory;
  adviceEntry?: AdviceLedgerEntry;
  adviceFeedback?: AdviceFeedback;
  moodEvents: MoodEvent[];
};

function moodEventForAdviceFeedback(input: {
  entry: AdviceLedgerEntry;
  feedback: AdviceFeedback;
  source: "menu" | "reaction";
  emoji?: MessageReaction;
  timestamp?: number;
}): MoodEvent {
  return proactiveToMoodEvent({
    kind: "advice_feedback",
    tone: input.entry.tone ?? "advice",
    feedback: input.feedback,
    timestamp: input.timestamp,
    metadata: {
      adviceId: input.entry.id,
      topicKey: input.entry.topicKey,
      candidateKind: input.entry.adviceCandidateKind,
      source: input.source,
      emoji: input.emoji,
    },
  });
}

function resultFromReactionLearning(
  learning: ReactionLearningResult,
  signal: Extract<FeedbackSignal, { kind: "message_reaction" }>,
): FeedbackSignalResult {
  const moodEvents = [
    reactionToMoodEvent({
      emoji: signal.emoji,
      messageId: signal.message.messageId,
      timestamp: signal.timestamp,
    }),
  ];

  if (learning.adviceEntry && learning.adviceFeedback) {
    moodEvents.push(
      moodEventForAdviceFeedback({
        entry: learning.adviceEntry,
        feedback: learning.adviceFeedback,
        source: "reaction",
        emoji: signal.emoji,
        timestamp: signal.timestamp,
      }),
    );
  }

  return {
    selfMemory: learning.selfMemory,
    adviceEntry: learning.adviceEntry,
    adviceFeedback: learning.adviceFeedback,
    moodEvents,
  };
}

export function recordFeedbackSignal(
  signal: FeedbackSignal,
): FeedbackSignalResult {
  if (signal.kind === "message_reaction") {
    return resultFromReactionLearning(
      recordReactionLearning({
        emoji: signal.emoji,
        message: signal.message,
      }),
      signal,
    );
  }

  if (signal.kind === "advice_feedback") {
    const updated = updateAdviceFeedback(
      signal.adviceId,
      signal.feedback,
      signal.timestamp,
    );
    if (!updated) {
      return { moodEvents: [] };
    }
    recordAdviceFeedbackOutcome(updated, signal.feedback, signal.timestamp);
    recordRelevanceFeedback(updated, signal.feedback);
    return {
      adviceEntry: updated,
      adviceFeedback: signal.feedback,
      moodEvents: [
        moodEventForAdviceFeedback({
          entry: updated,
          feedback: signal.feedback,
          source: signal.source,
          timestamp: signal.timestamp,
        }),
      ],
    };
  }

  if (signal.kind === "assistant_ignored") {
    return {
      moodEvents: [
        assistantIgnoredToMoodEvent({
          messageId: signal.messageId,
          source: signal.source,
          proactive: signal.proactive,
          adviceId: signal.adviceId,
          ageMs: signal.ageMs,
          ignoredStreak: signal.ignoredStreak,
          timestamp: signal.timestamp,
        }),
      ],
    };
  }

  return {
    selfMemory: updateAriSelfMemory(
      signal.currentSelfMemory ?? loadAriSelfMemory(),
      signal.userMessage,
      signal.assistantReply,
      signal.emotion,
    ),
    moodEvents: [],
  };
}
