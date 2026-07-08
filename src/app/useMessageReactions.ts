import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion, CharacterState } from "../types/character";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { AdviceFeedback } from "../character/adviceLedger";
import {
  pickReactionAcknowledgment,
  reactionAckEmotion,
  type MessageReaction,
} from "../character/messageReactions";
import { blipVoiceManager } from "../character/blipVoiceManager";
import { recordFeedbackSignal } from "../character/feedbackSignals";
import { acknowledgeAssistantMessage } from "../character/interactionAcknowledgement";
import type { MoodEvent } from "../character/moodEngine";
import type { AriSelfMemory } from "../character/selfMemory";

const REACTION_ACK_COOLDOWN_MS = 60_000;
const REACTION_ACK_PROBABILITY = 0.35;

export function useMessageReactions(input: {
  history: ChatMessage[];
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setSelfMemory: Dispatch<SetStateAction<AriSelfMemory>>;
  settings: AppSettings;
  activeWindow: ActiveWindowInfo | null;
  isOpen: boolean;
  onEmotionChange: (
    emotion: CharacterEmotion,
    reason?: "model" | "initiative" | "mood",
  ) => void;
  onStateChange: (state: CharacterState) => void;
  onProactiveMoodEvent?: (event: MoodEvent) => void;
}) {
  const [openBranchMenuIndex, setOpenBranchMenuIndex] = useState<number | null>(
    null,
  );
  const [openReactionMenuIndex, setOpenReactionMenuIndex] = useState<
    number | null
  >(null);
  const reactionAckCooldownRef = useRef(0);

  useEffect(() => {
    if (openBranchMenuIndex === null && openReactionMenuIndex === null) {
      return;
    }
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".message-actions-wrap")
      ) {
        return;
      }
      setOpenBranchMenuIndex(null);
      setOpenReactionMenuIndex(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openBranchMenuIndex, openReactionMenuIndex]);

  const emitMoodEvents = useCallback(
    (events: MoodEvent[]) => {
      for (const event of events) {
        input.onProactiveMoodEvent?.(event);
      }
    },
    [input],
  );

  const maybeAcknowledgeReaction = useCallback(
    async (emoji: MessageReaction) => {
      const now = Date.now();
      if (now - reactionAckCooldownRef.current < REACTION_ACK_COOLDOWN_MS) {
        return;
      }
      if (Math.random() > REACTION_ACK_PROBABILITY) {
        return;
      }

      reactionAckCooldownRef.current = now;
      const ackText = pickReactionAcknowledgment(emoji);
      const ackEmotion = reactionAckEmotion(emoji);
      input.setHistory((current) => [
        ...current,
        {
          role: "assistant",
          content: ackText,
          emotion: ackEmotion,
          messageId: crypto.randomUUID(),
          isCanon: false,
        },
      ]);
      input.onEmotionChange(ackEmotion, "mood");
      await blipVoiceManager.speak(ackText, {
        settings: input.settings,
        emotion: ackEmotion,
        force: true,
        activeWindow: input.activeWindow,
        onSpeakingStart: () => input.onStateChange("speaking"),
        onSpeakingEnd: () =>
          input.onStateChange(input.isOpen ? "listening" : "idle"),
      });
    },
    [input],
  );

  const markAdviceFeedback = useCallback(
    (messageIndex: number, adviceId: string, feedback: AdviceFeedback) => {
      acknowledgeAssistantMessage(input.history[messageIndex]?.messageId);
      const result = recordFeedbackSignal({
        kind: "advice_feedback",
        adviceId,
        feedback,
        source: "menu",
        message: input.history[messageIndex],
      });
      emitMoodEvents(result.moodEvents);
      input.setHistory((current) =>
        current.map((message, index) =>
          index === messageIndex
            ? { ...message, adviceFeedback: feedback }
            : message,
        ),
      );
      setOpenBranchMenuIndex(null);
    },
    [emitMoodEvents, input],
  );

  const setMessageReaction = useCallback(
    (messageIndex: number, emoji: MessageReaction) => {
      const message = input.history[messageIndex];
      if (!message || message.role !== "assistant") {
        return;
      }

      const nextReaction = message.reaction === emoji ? undefined : emoji;
      setOpenReactionMenuIndex(null);
      acknowledgeAssistantMessage(message.messageId);

      if (!nextReaction) {
        input.setHistory((current) =>
          current.map((item, index) =>
            index === messageIndex ? { ...item, reaction: undefined } : item,
          ),
        );
        return;
      }

      const result = recordFeedbackSignal({
        kind: "message_reaction",
        emoji: nextReaction,
        message,
      });
      if (result.selfMemory) {
        input.setSelfMemory(result.selfMemory);
      }
      input.setHistory((current) =>
        current.map((item, index) =>
          index === messageIndex
            ? {
                ...item,
                reaction: nextReaction,
                ...(result.adviceFeedback
                  ? { adviceFeedback: result.adviceFeedback }
                  : {}),
              }
            : item,
        ),
      );
      emitMoodEvents(result.moodEvents);
      void maybeAcknowledgeReaction(nextReaction);
    },
    [emitMoodEvents, input, maybeAcknowledgeReaction],
  );

  return {
    openBranchMenuIndex,
    setOpenBranchMenuIndex,
    openReactionMenuIndex,
    setOpenReactionMenuIndex,
    markAdviceFeedback,
    setMessageReaction,
  };
}
