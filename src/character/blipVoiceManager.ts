import type { AppSettings } from "../settings/appSettings";
import { isBlipVoiceEnabled } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { CharacterEmotion } from "../types/character";
import { decayMood, loadMood } from "./mood";
import { isFocusSessionActive } from "./focusSession";
import { isQuietModeActive } from "./quietMode";
import { isQuietHours } from "./reminders";
import {
  getEmotionVoiceProfile,
  sampleInterval,
  samplePitch,
} from "./emotionVoiceProfiles";
import {
  buildBlipEvents,
  buildMurmurChirp,
  type BlipEvent,
} from "./blipSyllables";
import {
  cleanTextForBlip,
  isTooLongForAutoBlip,
  resolveBlipScope,
  type BlipReplyMode,
} from "./blipTextUtils";
import { ensureAudioReady, playBlip, preloadBlipBank, stopAllBlips } from "./blipBank";
import { TextRevealEngine } from "./textRevealEngine";

export type BlipSpeakOptions = {
  settings: AppSettings;
  /** When set, overrides the static settings snapshot on each blip/reveal tick. */
  getSettings?: () => AppSettings;
  emotion?: CharacterEmotion;
  initiative?: boolean;
  reply?: boolean;
  pomodoro?: boolean;
  force?: boolean;
  test?: boolean;
  technical?: boolean;
  autoSpeak?: boolean;
  /** Visual typewriter for ambient bubble without full speak gates */
  revealOnly?: boolean;
  /** Proactive ambient bubble may use blip audio when chat is closed */
  ambientWithSound?: boolean;
  activeWindow?: ActiveWindowInfo | null;
  onSpeakingStart?: () => void;
  onSpeakingEnd?: () => void;
  onDisplayUpdate?: (displayText: string) => void;
};

type StreamSession = {
  token: number;
  options: BlipSpeakOptions;
  reveal: TextRevealEngine;
  mode: BlipReplyMode;
  speakingStarted: boolean;
  murmurPlayed: boolean;
  audioEnabled: boolean;
  sessionPitch: number;
  blipChain: Promise<void>;
  revealDone: boolean;
  streamEnded: boolean;
  onIdle?: () => void;
};

const VOICE_CHANGED_EVENT = "ari-voice-changed";

function moodVoiceScale(): number {
  const mood = decayMood(loadMood());
  let scale = 1;
  scale += (mood.energy - 0.45) * 0.14;
  scale += mood.irritation * 0.1;
  scale -= (mood.warmth - 0.35) * 0.04;
  return Math.max(0.86, Math.min(1.16, scale));
}

function dispatchVoiceChanged(): void {
  window.dispatchEvent(new Event(VOICE_CHANGED_EVENT));
}

function resolveSettings(options: BlipSpeakOptions): AppSettings {
  return options.getSettings?.() ?? options.settings;
}

function shouldGateSpeech(options: BlipSpeakOptions): boolean {
  const settings = resolveSettings(options);
  const toggleBypass = options.force || options.test;
  // Manual speech (force) should still produce audio even if the voice toggle is off,
  // otherwise the "speak" button appears broken.
  if (!isBlipVoiceEnabled(settings) && !toggleBypass && !options.test) {
    return false;
  }
  if (
    !options.test &&
    settings.blipMuteInQuietMode &&
    isQuietModeActive(settings, options.activeWindow)
  ) {
    return false;
  }
  if (
    !options.test &&
    settings.blipMuteDuringFocus &&
    isFocusSessionActive()
  ) {
    return false;
  }
  if (
    !options.test &&
    settings.blipMuteAtNight &&
    isQuietHours(settings)
  ) {
    return false;
  }
  if (options.initiative && !settings.blipSpeakInitiative && !toggleBypass) {
    if (!options.ambientWithSound) {
      return false;
    }
  }
  if (options.reply && !settings.blipSpeakReplies && !toggleBypass) {
    return false;
  }
  if (options.pomodoro && !settings.blipSpeakPomodoro && !toggleBypass) {
    return false;
  }
  return true;
}

function resolveSessionPitch(options: BlipSpeakOptions): number {
  const settings = resolveSettings(options);
  const profile = getEmotionVoiceProfile(options.emotion);
  return (
    settings.blipPitch *
    moodVoiceScale() *
    (settings.blipEmotionPitch || options.test ? samplePitch(profile) : 1)
  );
}

export function shouldBlipReveal(options: BlipSpeakOptions): boolean {
  return isBlipVoiceEnabled(resolveSettings(options)) && shouldGateSpeech(options);
}

export function shouldAmbientTextReveal(options: BlipSpeakOptions): boolean {
  if (!isBlipVoiceEnabled(resolveSettings(options)) && !options.revealOnly) {
    return false;
  }
  if (options.revealOnly) {
    return true;
  }
  return shouldBlipReveal(options);
}

class BlipVoiceManager {
  private sessionToken = 0;
  private active = false;
  private streamSession: StreamSession | null = null;
  private pendingTimeouts: number[] = [];

  constructor() {
    void preloadBlipBank();
  }

  isSpeaking(): boolean {
    return this.active;
  }

  stop(): void {
    const session = this.streamSession;
    const options = session?.options;
    const speakingStarted = session?.speakingStarted;
    const onIdle = session?.onIdle;

    this.sessionToken += 1;
    session?.reveal.stop();
    this.streamSession = null;
    this.active = false;
    for (const timer of this.pendingTimeouts) {
      window.clearTimeout(timer);
    }
    this.pendingTimeouts = [];
    stopAllBlips();
    dispatchVoiceChanged();

    if (speakingStarted) {
      options?.onSpeakingEnd?.();
    }
    onIdle?.();
  }

  beginStream(options: BlipSpeakOptions): boolean {
    if (!shouldAmbientTextReveal(options)) {
      return false;
    }
    if (this.active || this.streamSession) {
      this.stop();
    }

    const token = this.sessionToken;
    const audioEnabled = shouldGateSpeech(options);
    this.active = false;

    const reveal = new TextRevealEngine();
    const session: StreamSession = {
      token,
      options,
      reveal,
      mode: "animalese",
      speakingStarted: false,
      murmurPlayed: false,
      audioEnabled,
      sessionPitch: resolveSessionPitch(options),
      blipChain: Promise.resolve(),
      revealDone: false,
      streamEnded: false,
    };
    this.streamSession = session;

    const charsPerSecond = 28 * resolveSettings(options).blipSpeed;
    reveal.start({
      charsPerSecond,
      onReveal: (displayText, delta) => {
        if (token !== this.sessionToken || !this.streamSession) {
          return;
        }
        options.onDisplayUpdate?.(displayText);
        if (
          displayText.length > 0 &&
          session.audioEnabled &&
          !session.streamEnded &&
          session.mode === "murmur" &&
          !session.murmurPlayed
        ) {
          session.murmurPlayed = true;
          this.enqueueBlips(session, buildMurmurChirp(2));
        }
        if (
          delta &&
          session.audioEnabled &&
          !session.streamEnded &&
          session.mode !== "murmur"
        ) {
          void this.handleRevealDelta(session, delta);
        }
      },
      onComplete: () => {
        if (token !== this.sessionToken || !this.streamSession) {
          return;
        }
        session.revealDone = true;
        void this.tryFinishSession(session);
      },
    });

    if (audioEnabled) {
      void ensureAudioReady();
    }

    return true;
  }

  feedStream(text: string, emotion?: CharacterEmotion): void {
    const session = this.streamSession;
    if (!session) {
      return;
    }

    if (emotion) {
      session.options.emotion = emotion;
    }

    const scope = resolveBlipScope(text, {
      technical: session.options.technical,
      murmurForced:
        resolveSettings(session.options).blipShortRepliesOnly &&
        isTooLongForAutoBlip(text, resolveSettings(session.options)),
    });
    session.mode = scope.mode;
    session.sessionPitch = resolveSessionPitch(session.options);

    const settings = resolveSettings(session.options);
    session.reveal.setCharsPerSecond(28 * settings.blipSpeed);
    session.reveal.setTarget(text);
  }

  endStream(finalText: string): void {
    const session = this.streamSession;
    if (!session) {
      return;
    }

    this.feedStream(finalText, session.options.emotion);
    session.streamEnded = true;
    session.reveal.markStreamEnded();
    if (session.reveal.isCaughtUp()) {
      session.revealDone = true;
      void this.tryFinishSession(session);
      return;
    }
    session.reveal.flush();
  }

  endStreamAsync(finalText: string): Promise<void> {
    const session = this.streamSession;
    if (!session) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      session.onIdle = resolve;
      this.endStream(finalText);
    });
  }

  async testVoice(
    settings: AppSettings,
    emotion: CharacterEmotion = "happy",
  ): Promise<void> {
    await ensureAudioReady();
    await this.speak("Привет! Я Ari, и это мой blip voice.", {
      settings,
      emotion,
      force: true,
      test: true,
    });
  }

  speak(text: string, options: BlipSpeakOptions): Promise<boolean> {
    const cleaned = cleanTextForBlip(text);
    if (!cleaned) {
      return Promise.resolve(false);
    }
    if (
      options.onDisplayUpdate ||
      options.revealOnly ||
      shouldAmbientTextReveal(options)
    ) {
      if (this.beginStream(options)) {
        this.feedStream(cleaned, options.emotion);
        this.endStream(cleaned);
        return this.endStreamAsync(cleaned).then(() => true);
      }
    }
    return this.playSpeakableText(text, options);
  }

  private enqueueBlips(session: StreamSession, events: BlipEvent[]): void {
    session.blipChain = session.blipChain.then(async () => {
      await this.playEvents(events, session);
    });
  }

  private async handleRevealDelta(
    session: StreamSession,
    delta: string,
  ): Promise<void> {
    if (session.mode === "murmur") {
      return;
    }
    this.enqueueBlips(session, buildBlipEvents(delta));
  }

  private async tryFinishSession(session: StreamSession): Promise<void> {
    if (!session.revealDone || !session.streamEnded) {
      return;
    }
    try {
      await session.blipChain;
    } catch {
      // Blip playback errors should not leave the session stuck.
    }
    if (session.token !== this.sessionToken) {
      return;
    }
    this.finishSpeaking(session.options);
  }

  private async playSpeakableText(
    text: string,
    options: BlipSpeakOptions,
  ): Promise<boolean> {
    if (!shouldGateSpeech(options)) {
      return false;
    }

    const cleaned = cleanTextForBlip(text);
    if (!cleaned) {
      return false;
    }

    if (
      options.autoSpeak &&
      !options.force &&
      isTooLongForAutoBlip(cleaned, options.settings)
    ) {
      return false;
    }

    if (this.active || this.streamSession) {
      this.stop();
    }
    const token = this.sessionToken;
    this.active = true;
    dispatchVoiceChanged();
    options.onSpeakingStart?.();

    const sessionPitch = resolveSessionPitch(options);

    const scope = resolveBlipScope(cleaned, {
      technical: options.technical,
      murmurForced:
        resolveSettings(options).blipShortRepliesOnly &&
        isTooLongForAutoBlip(cleaned, resolveSettings(options)),
    });
    const events =
      scope.mode === "murmur"
        ? buildMurmurChirp(2)
        : buildBlipEvents(scope.text);

    await ensureAudioReady();
    const session: StreamSession = {
      token,
      options,
      reveal: new TextRevealEngine(),
      mode: scope.mode,
      speakingStarted: true,
      murmurPlayed: true,
      audioEnabled: true,
      sessionPitch,
      blipChain: Promise.resolve(),
      revealDone: true,
      streamEnded: true,
    };
    await this.playEvents(events, session);

    if (token !== this.sessionToken) {
      return false;
    }

    this.active = false;
    dispatchVoiceChanged();
    options.onSpeakingEnd?.();
    return events.length > 0;
  }

  private ensureSpeakingStarted(session: StreamSession): void {
    if (session.speakingStarted) {
      return;
    }
    session.speakingStarted = true;
    session.options.onSpeakingStart?.();
  }

  private async playEvents(
    events: BlipEvent[],
    session: StreamSession,
  ): Promise<void> {
    for (const event of events) {
      if (session.token !== this.sessionToken) {
        return;
      }
      await this.playEvent(event, session);
    }
  }

  private async playEvent(
    event: BlipEvent,
    session: StreamSession,
  ): Promise<void> {
    const token = this.sessionToken;
    if (!this.active) {
      this.active = true;
      dispatchVoiceChanged();
    }
    this.ensureSpeakingStarted(session);
    const options = session.options;
    const settings = resolveSettings(options);
    const profile = getEmotionVoiceProfile(options.emotion);
    const pitchJitter = 1 + (Math.random() * 2 - 1) * 0.04;
    const pitch = resolveSessionPitch(options) * pitchJitter;
    const volume =
      settings.blipVolume *
      profile.volumeScale *
      (settings.soundsEnabled ? 1 : 0.6);

    if (event.pauseMs > 0) {
      await this.delay(event.pauseMs / settings.blipSpeed);
      if (token !== this.sessionToken) {
        return;
      }
    }

    await playBlip({
      token: event.token,
      pitch,
      volume,
      durationScale: profile.blipDurationScale,
    });

    const interval = sampleInterval(profile) / settings.blipSpeed;
    await this.delay(interval);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pendingTimeouts = this.pendingTimeouts.filter(
          (item) => item !== timer,
        );
        resolve();
      }, ms);
      this.pendingTimeouts.push(timer);
    });
  }

  private finishSpeaking(options: BlipSpeakOptions): void {
    const session = this.streamSession;
    const wasActive = this.active;
    const speakingStarted = session?.speakingStarted ?? wasActive;
    const onIdle = session?.onIdle;
    session?.reveal.stop();
    this.streamSession = null;
    this.active = false;
    if (wasActive) {
      dispatchVoiceChanged();
    }
    if (speakingStarted) {
      options.onSpeakingEnd?.();
    }
    onIdle?.();
  }
}

export const blipVoiceManager = new BlipVoiceManager();
export { VOICE_CHANGED_EVENT };
export { cleanTextForBlip, isTooLongForAutoBlip } from "./blipTextUtils";
