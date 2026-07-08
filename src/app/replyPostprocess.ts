import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion } from "../types/character";
import type { CharacterRelationship } from "../character/relationship";
import {
  checkBondMilestone,
  markBondMilestone,
  updateRelationshipAfterExchange,
} from "../character/relationship";
import type { AriSelfMemory } from "../character/selfMemory";
import { recordFeedbackSignal } from "../character/feedbackSignals";
import {
  clearProactiveFailureBackoff,
  registerProactiveReplySubject,
} from "../character/proactiveState";
import { buildInitiativeSignalBundle } from "../character/initiativeContext";
import type { ProactiveReplyTone } from "../character/proactiveTone";
import {
  buildAdviceObservedState,
  startAdviceOutcomeObservation,
} from "../character/adviceOutcome";
import { rememberAdviceSent } from "../character/adviceLedger";
import { rememberReplyPhrases } from "../character/phraseMemory";
import { classifyUserIntent } from "../character/userIntent";
import type { OocValidationResult } from "../character/responseValidation";
import type { ResponseMode } from "../character/responseModes";
import {
  recordConversationMemoryExchange,
  shouldPostprocessConversationMemory,
} from "../memory/conversationMemory";
import { postprocessConversationMemory } from "../memory/conversationPostprocess";
import {
  addEpisodes,
  addOpenLoops,
  loadOpenLoops,
  resolveOpenLoops,
} from "../memory/episodicMemory";
import { applyExtractedFacts, shouldAutoCommitOpenLoop } from "../memory/memoryPolicy";
import {
  countPendingMemoryInboxItems,
  addToAriInbox,
} from "../memory/ariInbox";
import { getLastMemoryConflictDescription } from "../memory/userMemory";
import { isQuietModeActive } from "../character/quietMode";
import { loadProactiveRuntime, loadSafeActions } from "./chatRuntimeLoaders";
import type { ReplyGenerationOptions } from "./replyGenerationTypes";

type LogFn = (message: string, error: unknown) => void;
type AriLogFn = (
  channel: string,
  level: "debug" | "info" | "warn" | "error",
  payload?: Record<string, unknown>,
) => void;

export type ReplyPostprocessInput = {
  assistantIndex: number;
  assistantMessageId: string;
  baseHistory: ChatMessage[];
  options: ReplyGenerationOptions;
  settings: AppSettings;
  activeWindow: ActiveWindowInfo | null;
  observedActiveWindow: ActiveWindowInfo | null;
  finalReply: string;
  replyEmotion: CharacterEmotion;
  proactiveReplyTone?: ProactiveReplyTone;
  responseMode: ResponseMode | undefined;
  validation: OocValidationResult;
  lastUserMessage: string;
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setRelationship: Dispatch<SetStateAction<CharacterRelationship>>;
  setSelfMemory: Dispatch<SetStateAction<AriSelfMemory>>;
  onMoodInteraction?: (kind: "help_request" | "chat_positive") => void;
  logError: LogFn;
  ariLog: AriLogFn;
};

export async function runReplyPostprocess(
  input: ReplyPostprocessInput,
): Promise<void> {
  const {
    assistantIndex,
    assistantMessageId,
    baseHistory,
    options,
    settings,
    activeWindow,
    observedActiveWindow,
    finalReply,
    replyEmotion,
    proactiveReplyTone,
    responseMode,
    validation,
    lastUserMessage,
    setHistory,
    setRelationship,
    setSelfMemory,
    onMoodInteraction,
    logError,
    ariLog,
  } = input;

  const adviceEntry =
    options.proactive &&
    proactiveReplyTone === "advice" &&
    finalReply.trim()
      ? rememberAdviceSent({
          messageId: assistantMessageId,
          initiativeKind: options.initiativeKind,
          tone: proactiveReplyTone,
          anchor: options.initiativeAnchor,
          signalSummary: options.proactiveSignalSummary,
          linkNarrative: options.proactiveLinkNarrative,
          practicalHook: options.proactivePracticalHook,
          initiativeMove: options.proactiveInitiativeMove,
          adviceCandidateKind: options.proactiveAdviceCandidateKind,
          replyText: finalReply,
          processName: activeWindow?.processName,
          windowTitle: activeWindow?.title,
        })
      : null;

  if (adviceEntry) {
    const observedBundle = buildInitiativeSignalBundle(settings, {
      processName: observedActiveWindow?.processName,
      windowTitle: observedActiveWindow?.title,
    });
    const observedFacts = (
      await loadProactiveRuntime()
    ).collectProactiveSignalFacts({
      bundle: observedBundle,
      tone: "advice",
      candidateTopics: options.initiativeAnchor
        ? [options.initiativeAnchor]
        : undefined,
      recentUserMessage: [...baseHistory]
        .reverse()
        .find((message) => message.role === "user")
        ?.content,
    });
    startAdviceOutcomeObservation({
      adviceId: adviceEntry.id,
      topicKey: adviceEntry.topicKey,
      candidateKind: options.proactiveAdviceCandidateKind,
      beforeState: buildAdviceObservedState({
        topicKey: adviceEntry.topicKey,
        bundle: observedBundle,
        facts: observedFacts,
        processName: observedActiveWindow?.processName,
        windowTitle: observedActiveWindow?.title,
      }),
    });
  }

  setHistory((current) =>
    current.map((message, index) =>
      index === assistantIndex
        ? {
            ...message,
            content: finalReply,
            emotion: replyEmotion,
            ...(adviceEntry ? { adviceId: adviceEntry.id } : {}),
          }
        : message,
    ),
  );
  rememberReplyPhrases(finalReply, Boolean(options.proactive));
  if (options.proactive && finalReply.trim()) {
    clearProactiveFailureBackoff();
    registerProactiveReplySubject(options.initiativeAnchor, finalReply);
  }
  ariLog("reply-meta", "debug", {
    oocValidation: validation.valid ? "passed" : validation.issues.join(", "),
    responseMode,
  });

  if (
    settings.safeActionsEnabled &&
    !options.proactive &&
    !options.screenObservation &&
    lastUserMessage
  ) {
    void loadSafeActions().then((safeActions) =>
      safeActions
        .extractSafeAction(lastUserMessage, finalReply, settings, {
          activeWindow,
        })
        .then((action) => {
          if (!action) return;
          ariLog("reply-meta", "debug", {
            lastActionProposal: action.title,
          });
          setHistory((current) =>
            current.map((message) =>
              message.messageId === assistantMessageId &&
              message.role === "assistant" &&
              !message.action
                ? { ...message, action }
                : message,
            ),
          );
        })
        .catch((actionError: unknown) => {
          logError("Safe action extraction failed", actionError);
        }),
    );
  }

  if (!options.proactive && !options.screenObservation && lastUserMessage) {
    const userIntentForMood = classifyUserIntent(lastUserMessage);
    const isAdviceRequest =
      (userIntentForMood.intent === "technical_help" ||
        userIntentForMood.intent === "emotional_support" ||
        userIntentForMood.intent === "question") &&
      userIntentForMood.confidence >= 0.7;
    onMoodInteraction?.(isAdviceRequest ? "help_request" : "chat_positive");
    setRelationship((current) => {
      const updated = updateRelationshipAfterExchange(
        current,
        lastUserMessage,
        replyEmotion,
      );
      const milestone = checkBondMilestone(current, updated);
      if (milestone) {
        const marked = markBondMilestone(updated, milestone.level);
        setHistory((hist) => [
          ...hist,
          {
            role: "assistant",
            content: milestone.message,
            emotion: milestone.emotion,
          },
        ]);
        return marked;
      }
      return updated;
    });
    setSelfMemory((current) =>
      recordFeedbackSignal({
        kind: "conversation_exchange",
        userMessage: lastUserMessage,
        assistantReply: finalReply,
        emotion: replyEmotion,
        currentSelfMemory: current,
      }).selfMemory ?? current,
    );
    recordConversationMemoryExchange({
      userMessage: lastUserMessage,
      assistantReply: finalReply,
      emotion: replyEmotion,
    });
  }

  if (
    settings.userMemoryEnabled &&
    !options.proactive &&
    !options.screenObservation &&
    lastUserMessage &&
    shouldPostprocessConversationMemory(lastUserMessage, finalReply)
  ) {
    void loadOpenLoops()
      .then((loops) =>
        postprocessConversationMemory(
          lastUserMessage,
          finalReply,
          loops,
          settings,
        ),
      )
      .then(async ({ facts, episode, openLoops, resolvedLoopIds }) => {
        await applyExtractedFacts(facts, lastUserMessage);
        if (
          countPendingMemoryInboxItems() >= 3 &&
          !isQuietModeActive(settings, activeWindow)
        ) {
          setHistory((current) => [
            ...current,
            {
              role: "assistant",
              content:
                "Есть кандидаты в память - загляни во «Входящие» в настройках.",
              emotion: "curious",
            },
          ]);
        }
        ariLog("memory", "debug", {
          lastMemoryConflict: getLastMemoryConflictDescription(),
        });
        if (episode) {
          await addEpisodes([episode]);
        }
        for (const loop of openLoops) {
          if (shouldAutoCommitOpenLoop(loop)) {
            await addOpenLoops([loop]);
            continue;
          }
          addToAriInbox({
            kind: loop.dueAt ? "reminder" : "open_thread",
            title: loop.text.slice(0, 120),
            body: loop.text,
            sourceMessage: lastUserMessage,
            confidence: loop.confidence ?? 0.7,
            reason: loop.dueAt
              ? "Напоминание - требует подтверждения"
              : "Автоизвлечение open loop",
            metadata: loop.dueAt ? { dueAt: String(loop.dueAt) } : undefined,
          });
        }
        await resolveOpenLoops(resolvedLoopIds);
      })
      .catch((postprocessError: unknown) => {
        logError("Conversation memory postprocess failed", postprocessError);
      });
  }
}
