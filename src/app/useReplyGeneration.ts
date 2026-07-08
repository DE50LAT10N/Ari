import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion, CharacterState } from "../types/character";
import type { CharacterMood } from "../character/mood";
import {
  avatarEmotionFromMood,
  deriveMoodArchetype,
} from "../character/moodBehavior";
import type { AttentionState } from "../character/attention";
import type { CharacterRelationship } from "../character/relationship";
import type { PresenceScene } from "../character/presence";
import type { AriSelfMemory } from "../character/selfMemory";
import { buildMessages } from "../character/promptBuilder";
import { isQuietHours } from "../character/reminders";
import { registerProactiveFailure } from "../character/proactiveState";
import { recordInitiativeSuppressed } from "../memory/memoryTelemetry";
import { yieldToMain } from "../platform/asyncTimeout";
import { logError, ariLog } from "../platform/logger";
import { playUiSound } from "../character/soundDesign";
import {
  biasEmotionByMood,
  mergeReplyEmotionWithMood,
} from "../character/emotionPresentation";
import {
  blipVoiceManager,
  VOICE_CHANGED_EVENT,
} from "../character/blipVoiceManager";
import type { MoodTrigger } from "../character/moodTriggers";
import {
  runReplyRevisionPipeline,
  shouldSuppressProactiveReply,
} from "./replyRevisionPipeline";
import { buildReplyContext } from "./replyContextBuilder";
import { createReplyStreamSession } from "./replyStreamSession";
import { runReplyPostprocess } from "./replyPostprocess";
import type { ReplyGenerationOptions } from "./replyGenerationTypes";
import {
  describeProactiveFailure,
  getErrorMessage,
  isAbortError,
} from "./replyGenerationErrors";
import { useLatestRef, useStableCallback } from "./useStableCallbackRef";

type MutableRef<T> = { current: T };

export type ReplyGenerationInput = {
  abortControllerRef: MutableRef<AbortController | null>;
  streamedContentRef: MutableRef<string>;
  streamUiTimerRef: MutableRef<number | null>;
  pendingStreamContentRef: MutableRef<string>;
  historyRef: MutableRef<ChatMessage[]>;
  isLoadingRef: MutableRef<boolean>;
  activeWindowRef: MutableRef<ActiveWindowInfo | null>;
  topOpenLoopRef: MutableRef<string | undefined>;
  isOpen: boolean;
  settings: AppSettings;
  ollamaOnline: boolean | null;
  activeWindow: ActiveWindowInfo | null;
  mood: CharacterMood;
  relationship: CharacterRelationship;
  attention: AttentionState;
  scene: PresenceScene;
  selfMemory: AriSelfMemory;
  setError: Dispatch<SetStateAction<string | null>>;
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHasStreamTokens: Dispatch<SetStateAction<boolean>>;
  setStreamingContent: Dispatch<SetStateAction<string | null>>;
  setStreamingAssistantIndex: Dispatch<SetStateAction<number | null>>;
  setLiveToolStatus: Dispatch<SetStateAction<string | null>>;
  setRelationship: Dispatch<SetStateAction<CharacterRelationship>>;
  setSelfMemory: Dispatch<SetStateAction<AriSelfMemory>>;
  onAmbientBubble?: (text: string | null) => void;
  onEmotionChange: (
    emotion: CharacterEmotion,
    reason?: "model" | "initiative" | "mood",
  ) => void;
  onStateChange: (state: CharacterState) => void;
  onProactiveMessage: () => void;
  onProactiveEmitted?: (emotion: CharacterEmotion) => void;
  onMoodInteraction?: (kind: "help_request" | "chat_positive") => void;
  onMoodTrigger?: (trigger: MoodTrigger) => void;
};

export function useReplyGeneration(input: ReplyGenerationInput) {
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const inputRef = useLatestRef(input);

  useEffect(() => {
    const update = () => setVoiceSpeaking(blipVoiceManager.isSpeaking());
    window.addEventListener(VOICE_CHANGED_EVENT, update);
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, update);
  }, []);

  const generateReply = useStableCallback(
    async (
      baseHistory: ChatMessage[],
      options: ReplyGenerationOptions = {},
    ): Promise<boolean> => {
      const current = inputRef.current;
      const {
        abortControllerRef,
        streamedContentRef,
        streamUiTimerRef,
        pendingStreamContentRef,
        isLoadingRef,
        activeWindowRef,
        topOpenLoopRef,
        isOpen,
        settings,
        ollamaOnline,
        activeWindow,
        mood,
        relationship,
        attention,
        scene,
        selfMemory,
        setError,
        setHistory,
        setIsLoading,
        setHasStreamTokens,
        setStreamingContent,
        setStreamingAssistantIndex,
        setLiveToolStatus,
        setRelationship,
        setSelfMemory,
        onAmbientBubble,
        onEmotionChange,
        onStateChange,
        onProactiveMessage,
        onProactiveEmitted,
        onMoodInteraction,
        onMoodTrigger,
      } = current;

      if (isLoadingRef.current) {
        return false;
      }

      const assistantIndex = baseHistory.length;
      const controller = new AbortController();
      let failed = false;
      let replyEmotion: CharacterEmotion = "neutral";
      let finalReply = "";
      const assistantMessageId = crypto.randomUUID();
      let replyMoodContext = mood;

      function applyReplyEmotion(
        nextEmotion: CharacterEmotion,
        force = false,
      ) {
        if (!force && nextEmotion === "neutral") {
          return;
        }
        const archetype = deriveMoodArchetype(replyMoodContext);
        const avatarEmotion = avatarEmotionFromMood(replyMoodContext);
        let emotionToApply = nextEmotion;
        let reason: "model" | "initiative" | "mood" = options.proactive
          ? "initiative"
          : "model";
        if (archetype === "irritated" || options.proactive) {
          emotionToApply = avatarEmotion;
          reason = "mood";
        }
        onEmotionChange(emotionToApply, reason);
      }

      abortControllerRef.current = controller;
      isLoadingRef.current = true;
      streamedContentRef.current = "";
      setError(null);
      setHistory([
        ...baseHistory,
        {
          role: "assistant",
          content: "",
          emotion: "neutral",
          messageId: assistantMessageId,
          isCanon: true,
        },
      ]);
      setIsLoading(true);
      setHasStreamTokens(false);
      onStateChange("thinking");
      await yieldToMain();

      const wantAmbientReveal = !isOpen && Boolean(options.proactive);
      const proactiveWhileOpen = isOpen && Boolean(options.proactive);
      const streamSession = createReplyStreamSession({
        assistantIndex,
        controller,
        settings,
        activeWindow,
        isOpen,
        proactive: Boolean(options.proactive),
        proactiveWhileOpen,
        wantAmbientReveal,
        streamedContentRef,
        streamUiTimerRef,
        pendingStreamContentRef,
        setHasStreamTokens,
        setHistory,
        setStreamingContent,
        setStreamingAssistantIndex,
        onAmbientBubble,
        onStateChange,
        getReplyEmotion: () => replyEmotion,
        setReplyEmotion: (emotion) => {
          replyEmotion = emotion;
        },
      });

      streamSession.restartAmbientStream();

      try {
        const replyContext = await buildReplyContext({
          baseHistory,
          options,
          settings,
          activeWindow,
          ollamaOnline,
          mood,
          relationship,
          attention,
          scene,
          selfMemory,
          streamedEmotion: replyEmotion,
          setLiveToolStatus,
          logError,
          ariLog,
        });
        const {
          fittedHistory,
          runtimeContext,
          processReplyOptions,
          responseMode,
          proactiveReplyTone,
          moodForReply,
          lastUserMessage,
          proactiveLlm,
        } = replyContext;
        replyMoodContext = moodForReply;
        topOpenLoopRef.current = replyContext.topOpenLoop;
        if (replyContext.moodTriggerDescription) {
          onMoodTrigger?.(replyContext.moodTrigger);
          if (replyContext.hintedEmotion) {
            applyReplyEmotion(replyContext.hintedEmotion);
          }
        }
        streamSession.setTechnical(responseMode === "technical_help");

        const clearVisibleStreamDraft = streamSession.clearVisibleStreamDraft;
        const runStream = streamSession.runStream;

        let reply = await runStream(buildMessages(fittedHistory, runtimeContext));
        const revision = await runReplyRevisionPipeline({
          reply,
          fittedHistory,
          runtimeContext,
          processReplyOptions,
          settings,
          ollamaOnline,
          activeWindow,
          responseMode,
          proactive: Boolean(options.proactive),
          proactiveReplyTone,
          proactiveInitiativeMove: options.proactiveInitiativeMove,
          proactivePracticalHook: options.proactivePracticalHook,
          proactiveLinkNarrative: options.proactiveLinkNarrative,
          proactiveSignalSummary: options.proactiveSignalSummary,
          proactiveLlm,
          runStream,
          clearVisibleStreamDraft,
          logError,
          ariLog,
        });
        reply = revision.reply;
        const processed = revision.processed;

        if (
          options.proactive &&
          shouldSuppressProactiveReply(processed.validation.issues)
        ) {
          recordInitiativeSuppressed(
            `proactive reply novelty: ${processed.validation.issues.join(", ")}`,
          );
          failed = true;
          setHistory(baseHistory);
          if (wantAmbientReveal) {
            onAmbientBubble?.(null);
          }
          return false;
        }

        if (streamUiTimerRef.current) {
          window.clearTimeout(streamUiTimerRef.current);
          streamUiTimerRef.current = null;
        }
        setStreamingContent(null);
        setStreamingAssistantIndex(null);
        finalReply = processed.content;
        replyEmotion = mergeReplyEmotionWithMood(
          biasEmotionByMood(processed.emotion, moodForReply),
          moodForReply,
        );
        if (options.proactive) {
          replyEmotion = avatarEmotionFromMood(moodForReply);
        }
        applyReplyEmotion(replyEmotion, true);
        if (options.proactive && settings.proactiveOpenChat && !isOpen) {
          onProactiveMessage();
        }
        await runReplyPostprocess({
          assistantIndex,
          assistantMessageId,
          baseHistory,
          options,
          settings,
          activeWindow,
          observedActiveWindow: activeWindowRef.current,
          finalReply,
          replyEmotion,
          proactiveReplyTone,
          responseMode,
          validation: processed.validation,
          lastUserMessage,
          setHistory,
          setRelationship,
          setSelfMemory,
          onMoodInteraction,
          logError,
          ariLog,
        });
      } catch (requestError) {
        if (isAbortError(requestError)) {
          if (streamSession.isBlipStreamActive()) {
            streamSession.stopBlipStream();
          }
          if (!streamedContentRef.current) {
            setHistory(baseHistory);
          }
        } else {
          failed = true;
          if (!streamedContentRef.current) {
            setHistory(baseHistory);
          }
          if (options.proactive) {
            logError("Proactive message generation failed", requestError);
            const failureReason = describeProactiveFailure(requestError);
            const backoff = registerProactiveFailure(failureReason);
            recordInitiativeSuppressed(
              `proactive generation failed; backoff ${Math.ceil(
                (backoff.until - Date.now()) / 60_000,
              )}m: ${failureReason}`,
            );
            if (wantAmbientReveal) {
              onAmbientBubble?.(null);
            }
          } else {
            setError(getErrorMessage(requestError, settings.llmProvider));
            playUiSound("error", settings.soundsEnabled, isQuietHours(settings));
            onEmotionChange(
              "surprised",
              options.proactive ? "initiative" : "model",
            );
            onStateChange("error");
          }
        }
      } finally {
        abortControllerRef.current = null;
        isLoadingRef.current = false;
        setIsLoading(false);
        setHasStreamTokens(false);
        if (streamUiTimerRef.current) {
          window.clearTimeout(streamUiTimerRef.current);
          streamUiTimerRef.current = null;
        }
        setStreamingContent(null);
        setStreamingAssistantIndex(null);
        if (!failed) {
          if (streamSession.isBlipStreamActive()) {
            await streamSession.endBlipStream(finalReply);
          }
          if (options.proactive && !isOpen) {
            onProactiveEmitted?.(replyEmotion);
          }
          onStateChange(isOpen ? "listening" : "idle");
        } else if (wantAmbientReveal) {
          onAmbientBubble?.(null);
        }
      }
      return !failed;
    },
  );

  const stopGeneration = useStableCallback(() => {
    const current = inputRef.current;
    current.abortControllerRef.current?.abort();
    blipVoiceManager.stop();
    current.onStateChange(current.isOpen ? "listening" : "idle");
  });

  const stopVoice = useStableCallback(() => {
    const current = inputRef.current;
    blipVoiceManager.stop();
    current.onStateChange(current.isOpen ? "listening" : "idle");
  });

  const speakMessage = useStableCallback(
    async (content: string, messageEmotion?: CharacterEmotion) => {
      const current = inputRef.current;
      const emotion = messageEmotion ?? "neutral";
      current.onEmotionChange(emotion, "model");
      await blipVoiceManager.speak(content, {
        settings: current.settings,
        emotion,
        force: true,
        activeWindow: current.activeWindow,
        onSpeakingStart: () => inputRef.current.onStateChange("speaking"),
        onSpeakingEnd: () =>
          inputRef.current.onStateChange(
            inputRef.current.isOpen ? "listening" : "idle",
          ),
      });
    },
  );

  return {
    voiceSpeaking,
    generateReply,
    stopGeneration,
    stopVoice,
    speakMessage,
  };
}
