import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion, CharacterState } from "../types/character";
import { buildMessages } from "../character/promptBuilder";
import { blipVoiceManager } from "../character/blipVoiceManager";
import { isBlipVoiceEnabled } from "../settings/appSettings";
import { streamLlm } from "../llm/llmClient";
import { yieldToMain, withTimeout } from "../platform/asyncTimeout";
import {
  REPLY_AMBIENT_BUBBLE_MAX_CHARS,
  REPLY_STREAM_TIMEOUT_MS,
  REPLY_STREAM_UI_THROTTLE_MS,
} from "./replyGenerationPolicy";

type MutableRef<T> = { current: T };

type ReplyStreamSessionInput = {
  assistantIndex: number;
  controller: AbortController;
  settings: AppSettings;
  getSettings: () => AppSettings;
  activeWindow: ActiveWindowInfo | null;
  isOpen: boolean;
  proactive: boolean;
  proactiveWhileOpen: boolean;
  wantAmbientReveal: boolean;
  streamedContentRef: MutableRef<string>;
  streamUiTimerRef: MutableRef<number | null>;
  pendingStreamContentRef: MutableRef<string>;
  setHasStreamTokens: (value: boolean) => void;
  setHistory: Dispatch<SetStateAction<ChatMessage[]>>;
  setStreamingContent: (value: string | null) => void;
  setStreamingAssistantIndex: (value: number | null) => void;
  onAmbientBubble?: (text: string | null) => void;
  onStateChange: (state: CharacterState) => void;
  getReplyEmotion: () => CharacterEmotion;
  setReplyEmotion: (emotion: CharacterEmotion) => void;
};

function scheduleThrottledStreamUpdate(
  content: string,
  timerRef: MutableRef<number | null>,
  pendingRef: MutableRef<string>,
  onFlush: (value: string) => void,
  delayMs = REPLY_STREAM_UI_THROTTLE_MS,
): void {
  pendingRef.current = content;
  if (timerRef.current !== null) {
    return;
  }
  timerRef.current = window.setTimeout(() => {
    timerRef.current = null;
    onFlush(pendingRef.current);
  }, delayMs);
}

export function createReplyStreamSession(input: ReplyStreamSessionInput) {
  let streamEpoch = 0;
  let blipStreamActive = false;
  const blipOptions = {
    get settings() {
      return input.getSettings();
    },
    getSettings: input.getSettings,
    initiative: Boolean(input.proactive),
    reply: !input.proactive,
    technical: false,
    activeWindow: input.activeWindow,
    revealOnly: input.wantAmbientReveal,
    ambientWithSound:
      input.wantAmbientReveal && isBlipVoiceEnabled(input.getSettings()),
    onDisplayUpdate: (displayText: string) => {
      input.streamedContentRef.current = displayText;
      input.setHasStreamTokens(displayText.length > 0);
      input.setHistory((current) =>
        current.map((message, index) =>
          index === input.assistantIndex
            ? { ...message, content: displayText }
            : message,
        ),
      );
      if (input.wantAmbientReveal && displayText.trim()) {
        input.onAmbientBubble?.(
          displayText.slice(0, REPLY_AMBIENT_BUBBLE_MAX_CHARS),
        );
      }
    },
    onSpeakingStart: () => {
      input.onStateChange("speaking");
    },
    onSpeakingEnd: () => {
      input.onStateChange(input.isOpen ? "listening" : "idle");
    },
  };

  function restartAmbientStream(): void {
    blipVoiceManager.stop();
    blipStreamActive = blipVoiceManager.beginStream(blipOptions);
    if (!blipStreamActive) {
      input.setStreamingAssistantIndex(input.assistantIndex);
      input.setStreamingContent("");
    } else {
      input.setStreamingAssistantIndex(null);
      input.setStreamingContent(null);
    }
  }

  async function clearVisibleStreamDraft(): Promise<void> {
    if (input.streamUiTimerRef.current) {
      window.clearTimeout(input.streamUiTimerRef.current);
      input.streamUiTimerRef.current = null;
    }
    input.streamedContentRef.current = "";
    input.pendingStreamContentRef.current = "";
    input.setHasStreamTokens(false);
    input.setStreamingContent(null);
    input.setStreamingAssistantIndex(input.assistantIndex);
    input.setHistory((current) =>
      current.map((message, index) =>
        index === input.assistantIndex ? { ...message, content: "" } : message,
      ),
    );
    await yieldToMain();
  }

  async function runStream(
    messages: ReturnType<typeof buildMessages>,
    streamOptions: { revealToUser?: boolean } = {},
  ): Promise<string> {
    const revealToUser = streamOptions.revealToUser !== false;
    const epoch = ++streamEpoch;
    if (epoch > 1 && input.wantAmbientReveal && revealToUser) {
      restartAmbientStream();
    }
    return withTimeout(
      (streamSignal) =>
        streamLlm(
          messages,
          input.settings,
          (streamedContent) => {
            if (streamSignal.aborted || epoch !== streamEpoch) {
              return;
            }
          input.streamedContentRef.current = streamedContent;
          if (!revealToUser) {
            return;
          }
          if (blipStreamActive) {
            blipVoiceManager.feedStream(
              streamedContent,
              input.getReplyEmotion(),
            );
            if (streamedContent) {
              input.setHasStreamTokens(true);
              input.setHistory((current) =>
                current.map((message, index) =>
                  index === input.assistantIndex
                    ? { ...message, content: streamedContent }
                    : message,
                ),
              );
            }
            return;
          }

          if (streamedContent) {
            input.setHasStreamTokens(true);
            input.onStateChange("speaking");
            scheduleThrottledStreamUpdate(
              streamedContent,
              input.streamUiTimerRef,
              input.pendingStreamContentRef,
              (value) => {
                input.setStreamingContent(value);
                if (input.wantAmbientReveal && value.trim()) {
                  input.onAmbientBubble?.(
                    value.slice(0, REPLY_AMBIENT_BUBBLE_MAX_CHARS),
                  );
                }
              },
            );
          }
          },
          (emotion) => {
            if (streamSignal.aborted || epoch !== streamEpoch) {
              return;
            }
          if (!revealToUser) {
            return;
          }
          input.setReplyEmotion(emotion);
          input.setHistory((current) =>
            current.map((message, index) =>
              index === input.assistantIndex ? { ...message, emotion } : message,
            ),
          );
          },
          streamSignal,
        ),
      REPLY_STREAM_TIMEOUT_MS,
      "Генерация ответа",
      { signal: input.controller.signal },
    );
  }

  return {
    clearVisibleStreamDraft,
    endBlipStream: (finalReply: string) => blipVoiceManager.endStreamAsync(finalReply),
    isBlipStreamActive: () => blipStreamActive,
    restartAmbientStream,
    runStream,
    setTechnical: (technical: boolean) => {
      blipOptions.technical = technical;
    },
    stopBlipStream: () => {
      blipVoiceManager.stop();
    },
  };
}
