export type VoiceStyle = "off" | "blip";

export type AppSettings = {
  llmProvider: "ollama" | "gigachat";
  ollamaBaseUrl: string;
  ollamaModelsDir: string;
  model: string;
  fastJsonModel?: string;
  memoryModel?: string;
  gigaChatModel: string;
  gigaChatVisionModel: string;
  gigaChatEmbeddingModel: string;
  embeddingSource: "gigachat" | "ollama" | "none";
  visionSource: "gigachat" | "ollama";
  gigaChatScope: "GIGACHAT_API_PERS" | "GIGACHAT_API_B2B" | "GIGACHAT_API_CORP";
  temperature: number;
  maxTokens: number;
  contextTokens: number;
  ragEnabled: boolean;
  embeddingModel: string;
  ragTopK: number;
  ragScoreThreshold: number;
  memoryRelevanceFloor: number;
  codingProcessAllowlist: string;
  distractorProcessAllowlist: string;
  clipboardObservationEnabled: boolean;
  clipboardFullCaptureEnabled: boolean;
  advisorEnabled: boolean;
  activityTrackingEnabled: boolean;
  activityAllowlist: string;
  proactiveEnabled: boolean;
  /** @deprecated use proactiveAdviceIntervalMinutes / proactiveSmalltalkIntervalMinutes */
  proactiveIntervalMinutes: number;
  proactiveSmalltalkIntervalMinutes: number;
  proactiveAdviceIntervalMinutes: number;
  proactiveOpenChat: boolean;
  userMemoryEnabled: boolean;
  eventReactionsEnabled: boolean;
  remindersEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  safeActionsEnabled: boolean;
  visualMemoryMinutes: number;
  visionModel: string;
  quietMode: "off" | "until" | "process" | "manual";
  quietModeUntil?: number;
  quietModeProcess?: string;
  onboardingCompleted: boolean;
  userName: string;
  ariTone: "balanced" | "softer" | "sharper" | "quieter" | "technical";
  teasingLevel: "low" | "normal" | "high";
  warmthLevel: "low" | "normal" | "high";
  initiativeLevel: "silent" | "rare" | "normal" | "active";
  technicalDetail: "short" | "balanced" | "detailed";
  romanceMode: "disabled" | "subtle" | "allowed";
  nightBehavior: "quiet" | "normal";
  soundsEnabled: boolean;
  pomodoroEnabled: boolean;
  pomodoroFocusMinutes: number;
  pomodoroBreakMinutes: number;
  voiceStyle: VoiceStyle;
  blipVolume: number;
  blipPitch: number;
  blipSpeed: number;
  blipEmotionPitch: boolean;
  blipSpeakReplies: boolean;
  blipSpeakInitiative: boolean;
  blipSpeakPomodoro: boolean;
  blipShortRepliesOnly: boolean;
  blipMuteDuringFocus: boolean;
  blipMuteAtNight: boolean;
  blipMuteInQuietMode: boolean;
  blipMaxReplyChars: number;
  autoUpdateEnabled: boolean;
  autoVisionEnabled: boolean;
  webToolsEnabled: boolean;
  avatarLivelinessEnabled: boolean;
  rerankEnabled: boolean;
  llmRerankEnabled: boolean;
  intentClassifierEnabled: boolean;
  adaptiveInitiativeEnabled: boolean;
  moodEngineEnabled: boolean;
  recallLexicalWeight: number;
  recallSemanticWeight: number;
  embeddingQueryCacheTtlSec: number;
};

import { migrateGigaChatModelSettings } from "../llm/gigaChatModels";

const SETTINGS_KEY = "desktop-character.settings.v1";
const COMPANION_PRESENCE_MIGRATION_KEY =
  "desktop-character.settings-migration.companion-v2";

export const defaultSettings: AppSettings = {
  llmProvider: "ollama",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModelsDir: "",
  model: "hf.co/Qwen/Qwen3-14B-GGUF:Q5_K_M",
  gigaChatModel: "GigaChat-2-Pro",
  gigaChatVisionModel: "GigaChat-2-Pro",
  gigaChatEmbeddingModel: "EmbeddingsGigaR",
  embeddingSource: "gigachat",
  visionSource: "gigachat",
  gigaChatScope: "GIGACHAT_API_PERS",
  temperature: 0.7,
  maxTokens: 1024,
  contextTokens: 8192,
  ragEnabled: false,
  embeddingModel: "embeddinggemma",
  ragTopK: 4,
  ragScoreThreshold: 0.2,
  memoryRelevanceFloor: 0.12,
  codingProcessAllowlist: "",
  distractorProcessAllowlist: "",
  clipboardObservationEnabled: false,
  clipboardFullCaptureEnabled: true,
  advisorEnabled: true,
  activityTrackingEnabled: true,
  activityAllowlist: "",
  proactiveEnabled: true,
  proactiveIntervalMinutes: 20,
  proactiveSmalltalkIntervalMinutes: 10,
  proactiveAdviceIntervalMinutes: 20,
  proactiveOpenChat: true,
  userMemoryEnabled: true,
  eventReactionsEnabled: true,
  remindersEnabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 8,
  safeActionsEnabled: true,
  visualMemoryMinutes: 10,
  visionModel: "qwen2.5vl:7b",
  quietMode: "off",
  onboardingCompleted: false,
  userName: "",
  ariTone: "balanced",
  teasingLevel: "normal",
  warmthLevel: "normal",
  initiativeLevel: "normal",
  technicalDetail: "balanced",
  romanceMode: "subtle",
  nightBehavior: "normal",
  soundsEnabled: true,
  pomodoroEnabled: true,
  pomodoroFocusMinutes: 25,
  pomodoroBreakMinutes: 5,
  voiceStyle: "blip",
  blipVolume: 0.35,
  blipPitch: 1.0,
  blipSpeed: 1.0,
  blipEmotionPitch: true,
  blipSpeakReplies: true,
  blipSpeakInitiative: false,
  blipSpeakPomodoro: true,
  blipShortRepliesOnly: false,
  blipMuteDuringFocus: true,
  blipMuteAtNight: true,
  blipMuteInQuietMode: true,
  blipMaxReplyChars: 400,
  autoUpdateEnabled: false,
  autoVisionEnabled: false,
  webToolsEnabled: true,
  avatarLivelinessEnabled: true,
  rerankEnabled: true,
  llmRerankEnabled: false,
  intentClassifierEnabled: true,
  adaptiveInitiativeEnabled: false,
  moodEngineEnabled: true,
  recallLexicalWeight: 0.4,
  recallSemanticWeight: 0.6,
  embeddingQueryCacheTtlSec: 300,
};

function migrateLegacyTts(
  parsed: Partial<AppSettings> & Record<string, unknown>,
): Partial<AppSettings> {
  const next = { ...parsed };
  if (!parsed.voiceStyle) {
    next.voiceStyle = "blip";
  }
  if (typeof parsed.ttsVolume === "number" && parsed.blipVolume === undefined) {
    next.blipVolume = Math.min(0.5, parsed.ttsVolume * 0.45);
  }
  if (typeof parsed.ttsSpeedScale === "number" && parsed.blipSpeed === undefined) {
    next.blipSpeed = parsed.ttsSpeedScale;
  }
  if (typeof parsed.ttsSpeakReplies === "boolean" && parsed.blipSpeakReplies === undefined) {
    next.blipSpeakReplies = parsed.ttsSpeakReplies;
  }
  if (typeof parsed.ttsSpeakInitiative === "boolean" && parsed.blipSpeakInitiative === undefined) {
    next.blipSpeakInitiative = parsed.ttsSpeakInitiative;
  }
  if (typeof parsed.ttsSpeakPomodoro === "boolean" && parsed.blipSpeakPomodoro === undefined) {
    next.blipSpeakPomodoro = parsed.ttsSpeakPomodoro;
  }
  if (typeof parsed.ttsMuteDuringFocus === "boolean" && parsed.blipMuteDuringFocus === undefined) {
    next.blipMuteDuringFocus = parsed.ttsMuteDuringFocus;
  }
  if (typeof parsed.ttsMuteAtNight === "boolean" && parsed.blipMuteAtNight === undefined) {
    next.blipMuteAtNight = parsed.ttsMuteAtNight;
  }
  if (typeof parsed.ttsMaxReplyChars === "number" && parsed.blipMaxReplyChars === undefined) {
    next.blipMaxReplyChars = parsed.ttsMaxReplyChars;
  }
  return next;
}

function migrateCompanionPresence(settings: AppSettings): AppSettings {
  try {
    if (localStorage.getItem(COMPANION_PRESENCE_MIGRATION_KEY)) {
      return settings;
    }
    localStorage.setItem(COMPANION_PRESENCE_MIGRATION_KEY, "1");
    if (
      !settings.proactiveEnabled &&
      !settings.eventReactionsEnabled &&
      !settings.activityTrackingEnabled
    ) {
      return {
        ...settings,
        proactiveEnabled: true,
        eventReactionsEnabled: true,
        activityTrackingEnabled: true,
        proactiveIntervalMinutes: Math.min(settings.proactiveIntervalMinutes || 20, 20),
        proactiveSmalltalkIntervalMinutes: Math.min(
          settings.proactiveSmalltalkIntervalMinutes ||
            Math.max(5, Math.round((settings.proactiveIntervalMinutes || 20) * 0.5)),
          10,
        ),
        proactiveAdviceIntervalMinutes: Math.min(
          settings.proactiveAdviceIntervalMinutes ||
            settings.proactiveIntervalMinutes ||
            20,
          20,
        ),
      };
    }
  } catch {
    // ignore
  }
  return settings;
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return defaultSettings;
    }

    const parsed = JSON.parse(stored) as Partial<AppSettings> & {
      llmProvider?: string;
      ttsEnabled?: boolean;
    };
    const migrated = migrateLegacyTts(parsed);
    const legacyInterval =
      typeof migrated.proactiveIntervalMinutes === "number"
        ? migrated.proactiveIntervalMinutes
        : defaultSettings.proactiveIntervalMinutes;
    const proactiveAdviceIntervalMinutes =
      typeof migrated.proactiveAdviceIntervalMinutes === "number"
        ? migrated.proactiveAdviceIntervalMinutes
        : legacyInterval || defaultSettings.proactiveAdviceIntervalMinutes;
    const proactiveSmalltalkIntervalMinutes =
      typeof migrated.proactiveSmalltalkIntervalMinutes === "number"
        ? migrated.proactiveSmalltalkIntervalMinutes
        : Math.max(5, Math.round((legacyInterval || 20) * 0.5));
    return migrateGigaChatModelSettings(
      migrateCompanionPresence({
        ...defaultSettings,
        ...migrated,
        proactiveIntervalMinutes: proactiveAdviceIntervalMinutes,
        proactiveAdviceIntervalMinutes,
        proactiveSmalltalkIntervalMinutes,
        onboardingCompleted: migrated.onboardingCompleted ?? true,
        llmProvider:
          migrated.llmProvider === "gigachat" ? "gigachat" : "ollama",
        embeddingSource:
          migrated.embeddingSource === "ollama" ||
          migrated.embeddingSource === "none" ||
          migrated.embeddingSource === "gigachat"
            ? migrated.embeddingSource
            : defaultSettings.embeddingSource,
        visionSource:
          migrated.visionSource === "ollama" ||
          migrated.visionSource === "gigachat"
            ? migrated.visionSource
            : defaultSettings.visionSource,
        voiceStyle:
          migrated.voiceStyle === "off" || migrated.voiceStyle === "blip"
            ? migrated.voiceStyle
            : defaultSettings.voiceStyle,
      }),
    );
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function isBlipVoiceEnabled(settings: AppSettings): boolean {
  return settings.voiceStyle === "blip";
}
