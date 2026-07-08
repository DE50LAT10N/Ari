import { useCallback, useEffect, useState, type RefObject } from "react";
import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { CharacterEmotion, CharacterState } from "../types/character";
import type { CharacterMood } from "../character/mood";
import { deriveMoodArchetype } from "../character/moodBehavior";
import { blipVoiceManager, VOICE_CHANGED_EVENT } from "../character/blipVoiceManager";
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

export function useReplyGeneration(input: {
  abortControllerRef: RefObject<AbortController | null>;
  isOpen: boolean;
  settings: AppSettings;
  activeWindow: ActiveWindowInfo | null;
  onEmotionChange: (
    emotion: CharacterEmotion,
    reason?: "model" | "initiative" | "mood",
  ) => void;
  onStateChange: (state: CharacterState) => void;
}) {
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);

  useEffect(() => {
    const update = () => setVoiceSpeaking(blipVoiceManager.isSpeaking());
    window.addEventListener(VOICE_CHANGED_EVENT, update);
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, update);
  }, []);

  const stopGeneration = useCallback(() => {
    input.abortControllerRef.current?.abort();
    blipVoiceManager.stop();
    input.onStateChange(input.isOpen ? "listening" : "idle");
  }, [input]);

  const stopVoice = useCallback(() => {
    blipVoiceManager.stop();
    input.onStateChange(input.isOpen ? "listening" : "idle");
  }, [input]);

  const speakMessage = useCallback(
    async (content: string, messageEmotion?: CharacterEmotion) => {
      const emotion = messageEmotion ?? "neutral";
      input.onEmotionChange(emotion, "model");
      await blipVoiceManager.speak(content, {
        settings: input.settings,
        emotion,
        force: true,
        activeWindow: input.activeWindow,
        onSpeakingStart: () => input.onStateChange("speaking"),
        onSpeakingEnd: () =>
          input.onStateChange(input.isOpen ? "listening" : "idle"),
      });
    },
    [input],
  );

  return {
    voiceSpeaking,
    stopGeneration,
    stopVoice,
    speakMessage,
  };
}
