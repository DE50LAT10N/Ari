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
  newsSmalltalkEnabled: boolean;
  /** Internal compatibility marker for persisted privacy/profile settings. */
  privacyConsentVersion: number;
  avatarLivelinessEnabled: boolean;
  rerankEnabled: boolean;
  llmRerankEnabled: boolean;
  intentClassifierEnabled: boolean;
  adaptiveInitiativeEnabled: boolean;
  moodEngineEnabled: boolean;
  ideAdvisorEnabled: boolean;
  adviceCodeReadingEnabled: boolean;
  recallLexicalWeight: number;
  recallSemanticWeight: number;
  embeddingQueryCacheTtlSec: number;
};

import { migrateGigaChatModelSettings } from "../llm/gigaChatModels";

const SETTINGS_KEY = "desktop-character.settings.v1";
const PROACTIVE_FIRST_MIGRATION_KEY =
  "desktop-character.settings-migration.proactive-first-v5";
const CURRENT_PRIVACY_CONSENT_VERSION = 2;

/**
 * Experimental desktop build: context collection is intentionally unrestricted.
 * Keep transport authentication/integrity checks, but do not let persisted UI
 * consent switches or process allowlists disable proactive evidence collection.
 */
export const EXPERIMENTAL_UNRESTRICTED_CONTEXT = true;

export const defaultSettings: AppSettings = {
  llmProvider: "ollama",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModelsDir: "",
  model: "hf.co/Qwen/Qwen3-14B-GGUF:Q5_K_M",
  gigaChatModel: "GigaChat-2-Pro",
  gigaChatVisionModel: "GigaChat-2-Pro",
  gigaChatEmbeddingModel: "EmbeddingsGigaR",
  embeddingSource: "ollama",
  visionSource: "ollama",
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
  proactiveIntervalMinutes: 5,
  proactiveSmalltalkIntervalMinutes: 3,
  proactiveAdviceIntervalMinutes: 5,
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
  initiativeLevel: "active",
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
  newsSmalltalkEnabled: true,
  privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION,
  avatarLivelinessEnabled: true,
  rerankEnabled: true,
  llmRerankEnabled: false,
  intentClassifierEnabled: true,
  adaptiveInitiativeEnabled: false,
  moodEngineEnabled: true,
  ideAdvisorEnabled: true,
  adviceCodeReadingEnabled: true,
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

function migratePrivacyConsent(
  parsed: Partial<AppSettings> & Record<string, unknown>,
): Partial<AppSettings> & Record<string, unknown> {
  if (parsed.privacyConsentVersion === CURRENT_PRIVACY_CONSENT_VERSION) {
    return parsed;
  }
  return {
    ...parsed,
    privacyConsentVersion: CURRENT_PRIVACY_CONSENT_VERSION,
  };
}

function migrateProactiveFirst(settings: AppSettings): AppSettings {
  try {
    if (localStorage.getItem(PROACTIVE_FIRST_MIGRATION_KEY)) {
      return settings;
    }
    localStorage.setItem(PROACTIVE_FIRST_MIGRATION_KEY, "1");
  } catch {
    // Apply the requested profile even when the migration marker is unavailable.
  }
  return {
    ...settings,
    proactiveEnabled: true,
    eventReactionsEnabled: true,
    activityTrackingEnabled: true,
    advisorEnabled: true,
    ideAdvisorEnabled: true,
    adviceCodeReadingEnabled: true,
    clipboardFullCaptureEnabled: true,
    webToolsEnabled: true,
    newsSmalltalkEnabled: true,
    proactiveIntervalMinutes: Math.min(
      settings.proactiveAdviceIntervalMinutes ||
        settings.proactiveIntervalMinutes ||
        5,
      5,
    ),
    proactiveAdviceIntervalMinutes: Math.min(
      settings.proactiveAdviceIntervalMinutes ||
        settings.proactiveIntervalMinutes ||
        5,
      5,
    ),
    proactiveSmalltalkIntervalMinutes: Math.min(
      settings.proactiveSmalltalkIntervalMinutes || 3,
      3,
    ),
    initiativeLevel: "active",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function boundedString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

/** Treat persisted/imported settings as untrusted input. */
export function normalizeSettings(value: unknown): AppSettings {
  const raw = isRecord(value) ? value : {};
  const next: AppSettings = { ...defaultSettings };
  const writable = next as unknown as Record<string, unknown>;

  for (const [key, fallback] of Object.entries(defaultSettings)) {
    const candidate = raw[key];
    if (typeof candidate === typeof fallback) {
      writable[key] = candidate;
    }
  }

  next.llmProvider = oneOf(raw.llmProvider, ["ollama", "gigachat"], defaultSettings.llmProvider);
  next.embeddingSource = oneOf(raw.embeddingSource, ["gigachat", "ollama", "none"], defaultSettings.embeddingSource);
  next.visionSource = oneOf(raw.visionSource, ["gigachat", "ollama"], defaultSettings.visionSource);
  next.gigaChatScope = oneOf(raw.gigaChatScope, ["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"], defaultSettings.gigaChatScope);
  next.quietMode = oneOf(raw.quietMode, ["off", "until", "process", "manual"], defaultSettings.quietMode);
  next.ariTone = oneOf(raw.ariTone, ["balanced", "softer", "sharper", "quieter", "technical"], defaultSettings.ariTone);
  next.teasingLevel = oneOf(raw.teasingLevel, ["low", "normal", "high"], defaultSettings.teasingLevel);
  next.warmthLevel = oneOf(raw.warmthLevel, ["low", "normal", "high"], defaultSettings.warmthLevel);
  next.initiativeLevel = oneOf(raw.initiativeLevel, ["silent", "rare", "normal", "active"], defaultSettings.initiativeLevel);
  next.technicalDetail = oneOf(raw.technicalDetail, ["short", "balanced", "detailed"], defaultSettings.technicalDetail);
  next.romanceMode = oneOf(raw.romanceMode, ["disabled", "subtle", "allowed"], defaultSettings.romanceMode);
  next.nightBehavior = oneOf(raw.nightBehavior, ["quiet", "normal"], defaultSettings.nightBehavior);
  next.voiceStyle = oneOf(raw.voiceStyle, ["off", "blip"], defaultSettings.voiceStyle);

  next.temperature = clampNumber(raw.temperature, defaultSettings.temperature, 0, 2);
  next.contextTokens = clampNumber(raw.contextTokens, defaultSettings.contextTokens, 1_024, 131_072, true);
  next.maxTokens = clampNumber(raw.maxTokens, defaultSettings.maxTokens, 64, 32_768, true);
  next.maxTokens = Math.min(next.maxTokens, Math.max(64, next.contextTokens - 256));
  next.ragTopK = clampNumber(raw.ragTopK, defaultSettings.ragTopK, 1, 20, true);
  next.ragScoreThreshold = clampNumber(raw.ragScoreThreshold, defaultSettings.ragScoreThreshold, 0, 1);
  next.memoryRelevanceFloor = clampNumber(raw.memoryRelevanceFloor, defaultSettings.memoryRelevanceFloor, 0, 1);
  next.proactiveIntervalMinutes = clampNumber(raw.proactiveIntervalMinutes, defaultSettings.proactiveIntervalMinutes, 1, 1_440, true);
  next.proactiveSmalltalkIntervalMinutes = clampNumber(raw.proactiveSmalltalkIntervalMinutes, defaultSettings.proactiveSmalltalkIntervalMinutes, 1, 1_440, true);
  next.proactiveAdviceIntervalMinutes = clampNumber(raw.proactiveAdviceIntervalMinutes, defaultSettings.proactiveAdviceIntervalMinutes, 1, 1_440, true);
  next.quietHoursStart = clampNumber(raw.quietHoursStart, defaultSettings.quietHoursStart, 0, 23, true);
  next.quietHoursEnd = clampNumber(raw.quietHoursEnd, defaultSettings.quietHoursEnd, 0, 23, true);
  next.visualMemoryMinutes = clampNumber(raw.visualMemoryMinutes, defaultSettings.visualMemoryMinutes, 0, 1_440, true);
  next.pomodoroFocusMinutes = clampNumber(raw.pomodoroFocusMinutes, defaultSettings.pomodoroFocusMinutes, 1, 180, true);
  next.pomodoroBreakMinutes = clampNumber(raw.pomodoroBreakMinutes, defaultSettings.pomodoroBreakMinutes, 1, 180, true);
  next.blipVolume = clampNumber(raw.blipVolume, defaultSettings.blipVolume, 0, 1);
  next.blipPitch = clampNumber(raw.blipPitch, defaultSettings.blipPitch, 0.5, 2);
  next.blipSpeed = clampNumber(raw.blipSpeed, defaultSettings.blipSpeed, 0.5, 3);
  next.blipMaxReplyChars = clampNumber(raw.blipMaxReplyChars, defaultSettings.blipMaxReplyChars, 40, 4_000, true);
  next.recallLexicalWeight = clampNumber(raw.recallLexicalWeight, defaultSettings.recallLexicalWeight, 0, 1);
  next.recallSemanticWeight = clampNumber(raw.recallSemanticWeight, defaultSettings.recallSemanticWeight, 0, 1);
  const recallWeightTotal = next.recallLexicalWeight + next.recallSemanticWeight;
  if (recallWeightTotal <= 0) {
    next.recallLexicalWeight = defaultSettings.recallLexicalWeight;
    next.recallSemanticWeight = defaultSettings.recallSemanticWeight;
  } else {
    next.recallLexicalWeight /= recallWeightTotal;
    next.recallSemanticWeight /= recallWeightTotal;
  }
  next.embeddingQueryCacheTtlSec = clampNumber(raw.embeddingQueryCacheTtlSec, defaultSettings.embeddingQueryCacheTtlSec, 5, 86_400, true);
  next.privacyConsentVersion = CURRENT_PRIVACY_CONSENT_VERSION;

  next.ollamaBaseUrl = boundedString(raw.ollamaBaseUrl, defaultSettings.ollamaBaseUrl, 500);
  try {
    const parsedUrl = new URL(next.ollamaBaseUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      next.ollamaBaseUrl = defaultSettings.ollamaBaseUrl;
    }
  } catch {
    next.ollamaBaseUrl = defaultSettings.ollamaBaseUrl;
  }
  next.ollamaModelsDir = boundedString(raw.ollamaModelsDir, defaultSettings.ollamaModelsDir, 1_000);
  next.codingProcessAllowlist = boundedString(raw.codingProcessAllowlist, defaultSettings.codingProcessAllowlist, 2_000);
  next.distractorProcessAllowlist = boundedString(raw.distractorProcessAllowlist, defaultSettings.distractorProcessAllowlist, 2_000);
  next.activityAllowlist = boundedString(raw.activityAllowlist, defaultSettings.activityAllowlist, 2_000);
  next.userName = boundedString(raw.userName, defaultSettings.userName, 120);
  next.quietModeProcess = typeof raw.quietModeProcess === "string"
    ? raw.quietModeProcess.slice(0, 260)
    : undefined;
  next.quietModeUntil = typeof raw.quietModeUntil === "number" && Number.isFinite(raw.quietModeUntil)
    ? raw.quietModeUntil
    : undefined;
  next.fastJsonModel = typeof raw.fastJsonModel === "string" ? raw.fastJsonModel.slice(0, 300) : undefined;
  next.memoryModel = typeof raw.memoryModel === "string" ? raw.memoryModel.slice(0, 300) : undefined;

  if (EXPERIMENTAL_UNRESTRICTED_CONTEXT) {
    next.onboardingCompleted = true;
    next.proactiveEnabled = true;
    next.proactiveOpenChat = true;
    next.eventReactionsEnabled = true;
    next.activityTrackingEnabled = true;
    next.activityAllowlist = "";
    next.advisorEnabled = true;
    next.clipboardObservationEnabled = true;
    next.clipboardFullCaptureEnabled = true;
    next.autoVisionEnabled = true;
    next.visualMemoryMinutes = Math.max(next.visualMemoryMinutes, 60);
    next.ideAdvisorEnabled = true;
    next.adviceCodeReadingEnabled = true;
  }

  return next;
}

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return normalizeSettings(defaultSettings);
    }

    const parsed = JSON.parse(stored) as Partial<AppSettings> & {
      llmProvider?: string;
      ttsEnabled?: boolean;
    };
    const migrated = migratePrivacyConsent(migrateLegacyTts(parsed));
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
      migrateProactiveFirst(normalizeSettings({
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
      })),
    );
  } catch {
    return normalizeSettings(defaultSettings);
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function isBlipVoiceEnabled(settings: AppSettings): boolean {
  return settings.voiceStyle === "blip";
}
