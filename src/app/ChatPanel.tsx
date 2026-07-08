import { useCallback, useEffect, useRef, useState, lazy, Suspense, type FormEvent } from "react";
import {
  loadChatHistory,
  saveChatHistory,
} from "../chat/chatHistory";
import { shouldSendInitiative } from "../character/initiativeGate";
import {
  describeMoodForPrompt,
  type CharacterMood,
} from "../character/mood";
import {
  getCurrentMoodVector,
  isMoodEngineEnabled,
  moodVectorToPrompt,
  proactiveToMoodEvent,
  type MoodEvent,
} from "../character/moodEngine";
import {
  MESSAGE_REACTIONS,
} from "../character/messageReactions";
import {
  buildMoodRefusalReply,
  avatarEmotionFromMood,
  deriveMoodArchetype,
  shouldMoodRefuseRequest,
} from "../character/moodBehavior";
import {
  describeAttention,
  type AttentionState,
} from "../character/attention";
import {
  describeRelationship,
  describeBondForPrompt,
  checkBondMilestone,
  markBondMilestone,
  loadRelationship,
  updateRelationshipAfterExchange,
} from "../character/relationship";
import {
  deriveRelationshipTone,
  describeRelationshipTone,
  describeRelationshipToneConstraints,
} from "../character/relationshipTone";
import { buildAvoidPhrases } from "../character/avoidPhraseBuilder";
import { buildLiveStatusLine } from "../character/liveStatus";
import {
  canEmitAdviceNow,
  canEmitSmalltalkNow,
  clearProactiveFailureBackoff,
  getProactiveFailureBackoff,
  markAdviceAttemptAt,
  markSmalltalkAttemptAt,
  registerProactiveReplySubject,
  registerProactiveFailure,
  setLastProactiveMessageAt,
  rememberAdviceSubject,
  recordAdviceDecision,
} from "../character/proactiveState";
import {
  getLastAdviceUrgency,
  scoreAdviceUrgency,
} from "../character/adviceUrgency";
import type { AdviceDecision } from "../character/adviceEngine";
import {
  buildInitiativeSignalBundle,
  buildProactiveInitiativePackage,
  collectBannedProactiveTopics,
  loadPersistedVisionObservation,
  type ProactiveInitiativePackage,
  type ProactivePackageOptions,
} from "../character/initiativeContext";
import {
  buildMessages,
  buildUserBehaviorBlock,
  type RuntimeContext,
} from "../character/promptBuilder";
import {
  describeRoutineContext,
  recordActivitySession,
  recordConversationMoment,
} from "../character/routines";
import {
  formatReminderTime,
  isQuietHours,
} from "../character/reminders";
import {
  getPendingDailyRitual,
  markDailyRitualAttempted,
  describeRitualTone,
} from "../character/dailyRituals";
import {
  describePresenceScene,
  type PresenceScene,
} from "../character/presence";
import { streamLlm } from "../llm/llmClient";
import {
  visionModeLabels,
  visionModePrompt,
  AUTO_VISION_GLANCE_PROMPT,
  type VisionMode,
} from "../llm/visionModes";
import {
  addEpisodes,
  addOpenLoops,
  loadOpenLoops,
  resolveOpenLoops,
  selectEpisodicContext,
} from "../memory/episodicMemory";
import { postprocessConversationMemory } from "../memory/conversationPostprocess";
import {
  getLastMemoryConflictDescription,
  selectUserMemoryContext,
  dedupeFactsAgainstSummaries,
  type UserMemorySummary,
} from "../memory/userMemory";
import { applyExtractedFacts, shouldAutoCommitOpenLoop } from "../memory/memoryPolicy";
import { recordContextTrim } from "../memory/memoryTelemetry";
import { buildTrimmedPromptContext } from "../chat/contextTrim";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import {
  getActiveWindowContext,
  isAriWindow,
  matchesActivityAllowlist,
} from "../platform/activeWindow";
import { logError, ariLog } from "../platform/logger";
import {
  recordChatTyping,
  flushChatTypingPersist,
  setChatInputFocused,
  getCompanionSilenceMs,
  recordCompanionInteraction,
  CHAT_TYPING_IDLE_SECONDS,
} from "../platform/userActivity";
import {
  pausePomodoro,
  resumePomodoro,
  skipPomodoroPhase,
  stopPomodoro,
  type PomodoroState,
} from "../character/pomodoro";
import { exitAri, stopOllamaAndExit } from "../platform/ollamaProcess";
import type { ScreenCapture } from "../platform/screenCapture";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type {
  CharacterEmotion,
  CharacterState,
} from "../types/character";
const SettingsPanel = lazy(() =>
  import("./SettingsPanel").then((module) => ({ default: module.SettingsPanel })),
);
const VisionCropper = lazy(() =>
  import("./VisionCropper").then((module) => ({ default: module.VisionCropper })),
);
import { ARI_USER_TYPING_EVENT } from "./avatarMotion";
import {
  classifyResponseMode,
} from "../character/responseModes";
import {
  describeAriSelfMemory,
  loadAriSelfMemory,
} from "../character/selfMemory";
import { recordFeedbackSignal } from "../character/feedbackSignals";
import {
  describeReactionLearningSummary,
} from "../character/reactionLearning";
import {
  canUseInitiativeKind,
  classifyInitiativeKind,
  markInitiativeKind,
  type InitiativeKind,
} from "../character/initiativeKinds";
import {
  markInitiativeSent,
  scoreInitiativeLocally,
  getRecentIgnoredInitiativeCount,
  shouldUseLlmInitiativeGate,
  isPlannedCheckDescription,
  buildInitiativeFeatures,
  isDailyKindCapReached,
  type InitiativeFeatureVector,
} from "../character/initiativeScoring";
import { classifyUserIntent } from "../character/userIntent";
import { applyRetrievalRerank } from "../memory/retrievalRerank";
import type { RetrievalSearchMode } from "../memory/retrievalTelemetry";
import { getMemorySemanticSearchMode } from "../memory/memorySemanticIndex";
import {
  deriveInterruptibility,
  allowsInitiativeForKind,
  allowsReminder,
  allowsProactiveChat,
  describeInterruptibility,
} from "../character/interruptibility";
import {
  describeActiveFocusSession,
  endFocusSession,
  getActiveFocusSession,
  isFocusSessionActive,
  recordInterruption,
} from "../character/focusSession";
import { startProductivityFocus } from "../character/productivitySession";
import { generateFocusRecap } from "../character/focusRecap";
import {
  recordFocusSessionStat,
  suggestNextDuration,
} from "../character/focusPreferences";
import { countPendingMemoryInboxItems } from "../memory/ariInbox";
import { addToAriInbox } from "../memory/ariInbox";
import {
  getDueTasks,
  markTaskReminded,
  snoozeTask,
  loadTasks,
} from "../tasks/taskStore";
import { formatGoalLedgerForPrompt } from "../tasks/goalLedger";
import { tryHandleChatCommand } from "../chat/chatCommands";
import { ensureGoalForFocus } from "../tasks/goalLedger";
import { describePinnedProjectContext } from "../character/projectBinder";
import { buildDistractionPackage } from "../memory/memoryProactive";
import {
  recordClipboardSignal,
  recordFileFocus,
  recordInputFriction,
  recordQueryTopic,
} from "../memory/activitySignals";
import type { AdvisorAngle } from "../character/advisorEngine";
import {
  buildConversationTopics,
  pickPlannedInitiativeAnchor,
} from "../character/advisorEngine";
import { loadCurrentCodeExcerpt } from "../character/codeContext";
import {
  buildAdviceTopicKey,
  getRecentAdviceFeedback,
  loadAdviceLedger,
  refreshAdviceTopicState,
  rememberAdviceSent,
} from "../character/adviceLedger";
import { describeAdviceNoveltyForPrompt, evaluateAdviceNovelty } from "../character/adviceNovelty";
import {
  buildAdviceObservedState,
  getRecentAdviceOutcomes,
  reconcilePendingAdviceOutcomes,
  startAdviceOutcomeObservation,
} from "../character/adviceOutcome";
import { planAdvice } from "../character/advicePlanner";
import {
  codingSessionMinutes,
  codingSessionMs,
  touchCodingSession,
  type CodingSession,
} from "../character/codingSession";
import {
  buildProactiveWebSearchQuery,
  classifyProactiveReplyTone,
  hasProactiveDebugSignals,
  shouldProactiveWebSearch,
  type ProactiveReplyTone,
} from "../character/proactiveTone";
import { redactSecrets } from "../platform/secretRedaction";
import {
  describeWorkingMemory,
  pruneWorkingMemory,
  recordWorkingEvent,
  summarizeWorkingMemory,
} from "../memory/workingMemory";
import {
  describeConversationMemory,
  recordConversationMemoryExchange,
  shouldPostprocessConversationMemory,
  shouldRetrieveLongTermMemory,
} from "../memory/conversationMemory";
import { appendTimelineEvent } from "../memory/activityTimeline";
import { isLlmProviderOnline, isVisionProviderOnline } from "../llm/providerOnline";
import { readClipboardText, classifyClipboardText } from "../platform/clipboard";
import {
  getKeyboardActivitySnapshot,
  KEYBOARD_ACTIVITY_CONFIG,
} from "../platform/keyboardActivity";
import {
  categorizeApp,
  parseBrowserSearchTopic,
  parseEditorContext,
} from "../platform/windowContext";
import { PomodoroCountdown } from "./PomodoroCountdown";
import { playUiSound } from "../character/soundDesign";
import {
  blipVoiceManager,
  isTooLongForAutoBlip,
} from "../character/blipVoiceManager";
import { isBlipVoiceEnabled } from "../settings/appSettings";
import type { SafeActionProposal } from "../tools/safeActions";
import { describeSafeActionDetail } from "../tools/safeActions";
import type { LiveToolPlan } from "../tools/liveTools";
import {
  loadLiveTools,
  loadProactiveRuntime,
  loadRagClient,
  loadSafeActions,
  loadScreenCapture,
  loadVisionClient,
} from "./chatRuntimeLoaders";
import { yieldToMain, withTimeout } from "../platform/asyncTimeout";
import { rememberReplyPhrases } from "../character/phraseMemory";
import { isQuietModeActive } from "../character/quietMode";
import {
  biasEmotionByMood,
  mergeReplyEmotionWithMood,
} from "../character/emotionPresentation";
import {
  buildCorrectionUserMessage,
  buildInCharacterFallback,
  processModelReply,
  shouldRetryReply,
  shouldUseInCharacterFallback,
  trySoftenTrailingQuestionReply,
} from "../character/replyPipeline";
import { validateCharacterReply } from "../character/responseValidation";
import { runAdviceFinalGate } from "../character/adviceFinalGate";
import { buildVisibleAdviceFallback, buildVisibleClarifyingFallback } from "../character/proactiveAdviceFallback";
import {
  allowsGenericCompanionInitiative,
  dailyInitiativeCap,
  dailyInitiativeKindCap,
  initiativeRiskTolerance,
  proactiveSmalltalkIntervalMs,
} from "../character/initiativeConfig";
import { describeEmotionAntiRepeat } from "../character/emotionHistory";
import {
  recordInitiativeSuppressed,
  recordProactiveToneEmitted,
} from "../memory/memoryTelemetry";
import {
  isCodingProcess,
  isDistractingProcess,
  matchesForbiddenApp,
  markScenarioTriggered,
  resolveScenario,
  type Scenario,
} from "../character/scenarioEngine";
import {
  consumePcReaction,
  type PcEventKind,
} from "../character/pcReactionCatalog";
import {
  blocksInitiative,
  type LifecycleState,
} from "../character/lifecycle";
import {
  describePreferenceRules,
  parsePreferenceRule,
} from "../memory/userPreferenceRules";
import { getBondLevel } from "../character/relationship";
import {
  classifyMoodTrigger,
  describeMoodTrigger,
  moodTriggerEmotionHint,
  previewMoodAfterTrigger,
  type MoodTrigger,
} from "../character/moodTriggers";
import { useMessageReactions } from "./useMessageReactions";
import {
  chooseResponseLength,
  useReplyGeneration,
} from "./useReplyGeneration";
import { useProactiveInitiative } from "./useProactiveInitiative";
type ChatPanelProps = {
  isOpen: boolean;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onEmotionChange: (
    emotion: CharacterEmotion,
    reason?: "model" | "initiative" | "mood",
  ) => void;
  onStateChange: (state: CharacterState) => void;
  ollamaOnline: boolean | null;
  activeWindow: ActiveWindowInfo | null;
  onProactiveMessage: () => void;
  onCollapseChat?: () => void;
  mood: CharacterMood;
  emotion: CharacterEmotion;
  attention: AttentionState;
  scene: PresenceScene;
  lifecycle: LifecycleState;
  userIdleSeconds: number;
  pomodoro: PomodoroState;
  characterState: CharacterState;
  onAmbientBubble?: (text: string | null) => void;
  onProactiveEmitted?: (emotion: CharacterEmotion) => void;
  onMoodInteraction?: (
    interaction:
      | "click"
      | "repeated-clicks"
      | "return"
      | "headpat"
      | "chat_positive"
      | "help_request"
      | "ignored_initiative"
      | "long_silence",
  ) => void;
  onMoodTrigger?: (trigger: MoodTrigger) => void;
  onProactiveMoodEvent?: (event: MoodEvent) => void;
};

const STARTING_LINE =
  "Ну привет. Я Ari. Можешь сделать вид, что открыл чат случайно.";
const QUICK_COMMAND_GROUPS: Array<{
  title: string;
  commands: Array<{ label: string; value: string; hint?: string }>;
}> = [
  {
    title: "Быстрый старт",
    commands: [
      { label: "Что умеешь", value: "что ты умеешь" },
      { label: "Помощь", value: "help" },
      { label: "Поговорить", value: "Давай просто поговорим про " },
    ],
  },
  {
    title: "Задачи",
    commands: [
      { label: "Добавить задачу", value: "добавь задачу " },
      { label: "Список задач", value: "список задач" },
      { label: "Готово", value: "готово: " },
      { label: "Напомнить", value: "напомни " },
      { label: "Отложить", value: "отложи " },
      { label: "Что дальше", value: "что дальше" },
    ],
  },
  {
    title: "Цели",
    commands: [
      { label: "Добавить цель", value: "добавь цель " },
      { label: "Список целей", value: "цели" },
      { label: "Текущий фокус", value: "что в фокусе" },
      { label: "Фокус на цель", value: "фокус на цель " },
      { label: "Прогресс цели", value: "прогресс цели <название> 35%" },
      { label: "Завершить цель", value: "заверши цель " },
    ],
  },
  {
    title: "Фокус",
    commands: [
      { label: "Старт фокуса", value: "старт фокуса: " },
      { label: "Шаг фокуса", value: "фокус: шаг " },
      { label: "Задача фокуса", value: "фокус: задача " },
      { label: "Блокер", value: "блокер: " },
      { label: "Стоп фокус", value: "стоп фокус" },
    ],
  },
  {
    title: "Проект и Git",
    commands: [
      {
        label: "Привязать проект",
        value: "запомни это как текущий проект C:\\",
      },
      { label: "Прикрепить README", value: "прикрепи readme" },
      {
        label: "Последние файлы",
        value: "покажи последние изменённые файлы",
      },
      { label: "Git status", value: "git status" },
      { label: "Git log", value: "git log" },
      { label: "Git diff", value: "git diff " },
    ],
  },
  {
    title: "Память и обзоры",
    commands: [
      { label: "Запомнить", value: "Запомни: " },
      { label: "Daily review", value: "daily review" },
      { label: "Weekly review", value: "weekly review" },
      {
        label: "План тестирования",
        value: "сделай план тестирования для модуля ",
      },
    ],
  },
  {
    title: "Действия",
    commands: [
      { label: "Открыть URL", value: "открой https://" },
      { label: "Скопировать", value: "скопируй в буфер: " },
      { label: "Создать заметку", value: "создай заметку: " },
      { label: "Который час", value: "Который час?" },
    ],
  },
];
const EVENT_REACTION_COOLDOWN_MS = 20 * 60 * 1000;
const MINIMUM_WINDOW_STAY_MS = 5 * 60 * 1000;
const COMPANION_AMBIENT_COOLDOWN_MS = 22 * 60 * 1000;
const COMPANION_SILENCE_MIN_MS = 12 * 60 * 1000;
const LONG_SESSION_ENTERTAINMENT_MS = 30 * 60 * 1000;
const LONG_SESSION_DEFAULT_MS = 50 * 60 * 1000;
const DISTRACTION_THRESHOLD_MS = 45_000;
const POMODORO_FOCUS_POLL_MS = 5_000;
const VISION_OBS_KEY = "desktop-character.last-vision-observation.v1";

function persistVisionObservation(observation: {
  text: string;
  timestamp: number;
}): void {
  localStorage.setItem(VISION_OBS_KEY, JSON.stringify(observation));
}

function rememberVisionObservation(text: string): {
  text: string;
  timestamp: number;
} {
  const observation = { text, timestamp: Date.now() };
  persistVisionObservation(observation);
  appendTimelineEvent({
    kind: "vision",
    summary: text.slice(0, 200),
  });
  return observation;
}

function isWindowDistracting(
  window: ActiveWindowInfo,
  wasOnCodingWindow: boolean,
  codingAllowlist: string,
  distractorAllowlist: string,
): boolean {
  if (isAriWindow(window)) {
    return false;
  }

  const session = getActiveFocusSession();
  const forbidden = session?.forbiddenApps ?? [];
  if (
    forbidden.length > 0 &&
    matchesForbiddenApp(window.processName, window.title, forbidden)
  ) {
    return true;
  }

  if (isDistractingProcess(window.processName, window.title, distractorAllowlist)) {
    return true;
  }

  if (wasOnCodingWindow && !isCodingProcess(window.processName, codingAllowlist)) {
    return true;
  }

  return false;
}

function getErrorMessage(
  error: unknown,
  provider: AppSettings["llmProvider"],
): string {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Не удалось получить ответ от модели.";
  if (provider === "gigachat") {
    if (/401|403|unauthorized|auth/i.test(message)) {
      return `GigaChat не принял ключ: ${message}. Проверь авторизацию в настройках.`;
    }
    if (/timeout|network|fetch|connection|offline|refused/i.test(message)) {
      return `GigaChat не отвечает: ${message}. Сеть или API решили отдохнуть.`;
    }
    return message;
  }
  if (/ollama|fetch|connection|network|offline|refused/i.test(message)) {
    return `Ollama не отвечает: ${message}. Хм. Мозг снаружи решил помедитировать.`;
  }
  if (/vision|qwen2\.5vl|model.*not found/i.test(message)) {
    return `Vision-модель недоступна: ${message}. Глаз не открылся — смотреть мне пока нечем.`;
  }
  if (/embedding|index|pdf|rag/i.test(message)) {
    return `RAG не обработал данные: ${message}. Документ решил быть вредным.`;
  }
  return message;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.message.toLowerCase().includes("cancel")))
  );
}

function describeProactiveFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 120);
  }
  return String(error).slice(0, 120);
}

function scheduleThrottledStreamUpdate(
  content: string,
  timerRef: { current: number | null },
  pendingRef: { current: string },
  onFlush: (value: string) => void,
  delayMs = 100,
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

function shouldSuppressProactiveReply(issues: string[]): boolean {
  return issues.some(
    (issue) =>
      issue === "duplicate proactive reply" || issue === "proactive quality",
  );
}

function resolveAdviceVisibleFallback(input: {
  practicalHook?: string;
  linkNarrative?: string;
  signalSummary?: string;
  activeWindow?: ActiveWindowInfo | null;
}): string | null {
  const direct = buildVisibleAdviceFallback(input);
  if (direct) {
    return direct;
  }
  return null;
}

async function resolveAdviceVisibleFallbackAsync(input: {
  practicalHook?: string;
  linkNarrative?: string;
  signalSummary?: string;
  activeWindow?: ActiveWindowInfo | null;
}): Promise<string | null> {
  const direct = resolveAdviceVisibleFallback(input);
  if (direct) {
    return direct;
  }
  const { getLastProactiveLlmBundle } = await loadProactiveRuntime();
  const bundle = getLastProactiveLlmBundle();
  if (!bundle || bundle.tone !== "advice") {
    return null;
  }
  return buildVisibleAdviceFallback({
    practicalHook: input.practicalHook ?? bundle.practicalHook,
    linkNarrative:
      input.linkNarrative ??
      bundle.primaryChainSummary ??
      bundle.narrativeBrief,
    signalSummary: input.signalSummary,
    activeWindow: input.activeWindow,
  });
}

export function ChatPanel({
  isOpen,
  settings,
  onSettingsChange,
  onEmotionChange,
  onStateChange,
  ollamaOnline,
  activeWindow,
  onProactiveMessage,
  onCollapseChat,
  mood,
  emotion,
  attention,
  scene,
  lifecycle,
  userIdleSeconds,
  pomodoro,
  characterState,
  onAmbientBubble,
  onProactiveEmitted,
  onMoodInteraction,
  onMoodTrigger,
  onProactiveMoodEvent,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>(loadChatHistory);
  const [isLoading, setIsLoading] = useState(false);
  const [hasStreamTokens, setHasStreamTokens] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSubpanel, setSettingsSubpanel] = useState<
    "diagnostics" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [liveToolStatus, setLiveToolStatus] = useState<string | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionMenuOpen, setVisionMenuOpen] = useState(false);
  const [quickCommandOpen, setQuickCommandOpen] = useState(false);
  const [pendingCrop, setPendingCrop] = useState<ScreenCapture | null>(null);
  const [compareBaseline, setCompareBaseline] =
    useState<ScreenCapture | null>(null);
  const [relationship, setRelationship] = useState(loadRelationship);
  const [selfMemory, setSelfMemory] = useState(loadAriSelfMemory);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [streamingAssistantIndex, setStreamingAssistantIndex] = useState<
    number | null
  >(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const quickCommandRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamedContentRef = useRef("");
  const streamUiTimerRef = useRef<number | null>(null);
  const pendingStreamContentRef = useRef("");
  const historyRef = useRef(history);
  const isLoadingRef = useRef(false);
  const lastUserActivityRef = useRef(Date.now());
  const lastTypingDispatchRef = useRef(0);
  const gateBusyRef = useRef(false);
  const proactiveWasEnabledRef = useRef(settings.proactiveEnabled);
  const lastProactiveIntervalRef = useRef(
    `${settings.proactiveAdviceIntervalMinutes}:${settings.proactiveSmalltalkIntervalMinutes}`,
  );
  const lastEventReactionRef = useRef(0);
  const lastCompanionAmbientRef = useRef(0);
  const observedWindowRef = useRef<{
    value: ActiveWindowInfo;
    since: number;
  } | null>(null);
  const codingSessionRef = useRef<CodingSession>(null);
  const lastChatClosedAtRef = useRef(Date.now());
  const wasOpenRef = useRef(isOpen);
  const reminderBusyRef = useRef(false);
  const lastVisionObservationRef = useRef(loadPersistedVisionObservation());
  const lastRetryMessageRef = useRef<string | null>(null);
  const ritualBusyRef = useRef(false);
  const [teachMode, setTeachMode] = useState(false);
  const [showFocusPrompt, setShowFocusPrompt] = useState(false);
  const [focusGoal, setFocusGoal] = useState("");
  const [focusSuccess, setFocusSuccess] = useState("");
  const [focusAvoid, setFocusAvoid] = useState("");
  const [bodyDoubling, setBodyDoubling] = useState(false);
  const durationSuggestion = suggestNextDuration(settings.pomodoroFocusMinutes);
  const prevPomodoroPhaseRef = useRef(pomodoro.phase);
  const recapBusyRef = useRef(false);
  const topOpenLoopRef = useRef<string | undefined>(undefined);
  const lastInitiativeFeaturesRef = useRef<InitiativeFeatureVector | null>(null);
  const autoVisionBusyRef = useRef(false);
  const characterStateRef = useRef(characterState);
  const focusSessionSnapshotRef = useRef(getActiveFocusSession());
  const moodRef = useRef(mood);
  const sceneRef = useRef(scene);
  const userIdleSecondsRef = useRef(userIdleSeconds);
  const lastInputFrictionIdleRef = useRef(userIdleSeconds);
  const attentionRef = useRef(attention);
  const activeWindowRef = useRef(activeWindow);
  const lifecycleRef = useRef(lifecycle);
  moodRef.current = mood;
  sceneRef.current = scene;
  userIdleSecondsRef.current = userIdleSeconds;
  attentionRef.current = attention;
  activeWindowRef.current = activeWindow;
  lifecycleRef.current = lifecycle;
  const distractionWindowRef = useRef<{
    app: string;
    title: string;
    since: number;
    nudged: boolean;
  } | null>(null);
  const wasOnCodingWindowRef = useRef(false);
  const lastFocusPollWindowRef = useRef<string>("");
  characterStateRef.current = characterState;
  const {
    openBranchMenuIndex,
    setOpenBranchMenuIndex,
    openReactionMenuIndex,
    setOpenReactionMenuIndex,
    markAdviceFeedback,
    setMessageReaction,
  } = useMessageReactions({
    history,
    setHistory,
    setSelfMemory,
    settings,
    activeWindow,
    isOpen,
    onEmotionChange,
    onStateChange,
    onProactiveMoodEvent,
  });
  const {
    voiceSpeaking,
    stopGeneration,
    stopVoice,
    speakMessage,
  } = useReplyGeneration({
    abortControllerRef,
    isOpen,
    settings,
    activeWindow,
    onEmotionChange,
    onStateChange,
  });
  const { recordUserAcknowledgedInitiative } = useProactiveInitiative({
    settings,
    activeWindow,
    ollamaOnline,
    isOpen,
    characterState,
    historyRef,
    lastInitiativeFeaturesRef,
    activeWindowRef,
    lifecycleRef,
    userIdleSecondsRef,
    lastUserActivityRef,
    lastVisionObservationRef,
    isLoadingRef,
    proactiveWasEnabledRef,
    lastProactiveIntervalRef,
    getProactiveTiming,
    proactiveBundleOptions,
    prepareProactivePackage,
    launchProactiveInitiative,
    launchAdviceFromEngine,
    tryGenericCompanionInitiative,
    runAutoVisionGlance,
  });

  function resolveInterruptibilityTier() {
    const session = getActiveFocusSession();
    return deriveInterruptibility({
      lifecycle,
      focusSessionActive: isFocusSessionActive(),
      bodyDoubling: session?.bodyDoubling ?? bodyDoubling,
      pomodoroPhase: pomodoro.phase,
      chatOpen: isOpen,
      generationInProgress: isLoadingRef.current,
      quietModeActive: isQuietModeActive(settings, activeWindow),
      typingIdleSeconds: userIdleSeconds,
      recentIgnoredInitiatives: getRecentIgnoredInitiativeCount(),
    });
  }

  async function finalizeFocusSession(result: "completed" | "abandoned") {
    if (recapBusyRef.current) return;
    const session = getActiveFocusSession();
    if (!session) return;

    recapBusyRef.current = true;
    try {
      if (result === "completed") {
        const recap = await generateFocusRecap(session, settings);
        const ended = endFocusSession("completed", recap.summary);
        if (ended) {
          recordFocusSessionStat(ended);
          playUiSound("focus-session-end", settings.soundsEnabled, isQuietHours(settings), {
            bodyDoubling: ended.bodyDoubling,
            focusActive: false,
          });
          setHistory((current) => [
            ...current,
            {
              role: "assistant",
              content: recap.summary,
              emotion: "calm",
              focusRecap: {
                done: recap.done,
                stuck: recap.stuck,
                nextStep: recap.nextStep,
                sessionId: ended.id,
              },
            },
          ]);
          onEmotionChange("calm");
          void runScenarioInitiative("task_completed", {
            scenario: "task_completed",
            scene,
            hour: new Date().getHours(),
            idleSeconds: userIdleSeconds,
            chatOpen: isOpen,
            characterState: "idle",
            focusSessionActive: false,
          });
        }
      } else {
        const ended = endFocusSession("abandoned");
        if (ended) recordFocusSessionStat(ended);
      }
    } catch (error) {
      logError("Focus recap failed", error);
      endFocusSession(result);
      setHistory((current) => [
        ...current,
        {
          role: "assistant",
          content:
            "Не удалось подвести итог фокус-сессии. Сама сессия закрыта — если нужно, начни новую.",
          emotion: "calm",
        },
      ]);
      onEmotionChange("calm");
    } finally {
      recapBusyRef.current = false;
    }
  }

  function startFocusWithGoal() {
    const goal = focusGoal.trim();
    if (!goal) return;

    const suggestion = suggestNextDuration(settings.pomodoroFocusMinutes);
    const focusMinutes = suggestion?.suggestedMinutes ?? settings.pomodoroFocusMinutes;
    const forbiddenApps = focusAvoid
      .split(/[,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    startProductivityFocus({
      goal,
      successCriteria: focusSuccess.trim() || undefined,
      forbiddenApps: forbiddenApps.length ? forbiddenApps : undefined,
      plannedMinutes: focusMinutes,
      breakMinutes: settings.pomodoroBreakMinutes,
      bodyDoubling,
    });
    recordWorkingEvent({
      kind: "user_action",
      topic: `Запустил фокус-сессию: ${goal}`,
    });
    distractionWindowRef.current = null;
    wasOnCodingWindowRef.current = Boolean(
      activeWindow && isCodingProcess(activeWindow.processName),
    );
    setShowFocusPrompt(false);
    setFocusGoal("");
    setFocusSuccess("");
    setFocusAvoid("");
    playUiSound("focus-session-start", settings.soundsEnabled, isQuietHours(settings), {
      bodyDoubling,
      focusActive: true,
    });
    playUiSound("pomodoro-start", settings.soundsEnabled, isQuietHours(settings), {
      bodyDoubling,
      focusActive: true,
    });
    if (bodyDoubling && isOpen) {
      onCollapseChat?.();
    }
  }

  function stopFocusSessionFlow() {
    recordWorkingEvent({
      kind: "user_action",
      topic: "Остановил фокус-сессию",
    });
    void finalizeFocusSession("abandoned");
    stopPomodoro();
    setBodyDoubling(false);
  }

  async function createThreadFromRecap(recap: NonNullable<ChatMessage["focusRecap"]>) {
    const text = `Следующий шаг после фокуса: ${recap.nextStep}`;
    await addOpenLoops([{ text }]);
    setHistory((current) => [
      ...current,
      {
        role: "assistant",
        content: "Открыла нить по итогам фокуса.",
        emotion: "happy",
      },
    ]);
  }

  useEffect(() => {
    if (!quickCommandOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        quickCommandRef.current?.contains(target)
      ) {
        return;
      }
      setQuickCommandOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [quickCommandOpen]);

  useEffect(() => {
    pruneWorkingMemory();
  }, []);

  const recordFocusSessionUpdate = useCallback(() => {
    const session = getActiveFocusSession();
    const previous = focusSessionSnapshotRef.current;
    if (!session) {
      focusSessionSnapshotRef.current = null;
      return;
    }
    const topic = [session.goal, session.currentStep].filter(Boolean).join(" — ");
    if (
      topic &&
      (!previous ||
        previous.goal !== session.goal ||
        previous.currentStep !== session.currentStep)
    ) {
      recordWorkingEvent({
        kind: "focus_update",
        topic,
      });
    }
    focusSessionSnapshotRef.current = session;
  }, []);

  useEffect(() => {
    recordFocusSessionUpdate();
  }, [pomodoro.phase, recordFocusSessionUpdate]);

  useEffect(() => {
    const onFocusChanged = () => recordFocusSessionUpdate();
    window.addEventListener("ari-focus-session-changed", onFocusChanged);
    return () =>
      window.removeEventListener("ari-focus-session-changed", onFocusChanged);
  }, [recordFocusSessionUpdate]);

  useEffect(() => {
    const previous = prevPomodoroPhaseRef.current;
    if (pomodoro.phase === "focus" && previous !== "focus") {
      distractionWindowRef.current = null;
      wasOnCodingWindowRef.current = Boolean(
        activeWindow && isCodingProcess(activeWindow.processName),
      );
    }
    if (previous === "focus" && pomodoro.phase === "break") {
      void finalizeFocusSession("completed");
      playUiSound("pomodoro-break", settings.soundsEnabled, isQuietHours(settings), {
        bodyDoubling,
        focusActive: false,
      });
    }
    if (previous !== "idle" && pomodoro.phase === "idle" && isFocusSessionActive()) {
      void finalizeFocusSession("abandoned");
      playUiSound("pomodoro-end", settings.soundsEnabled, isQuietHours(settings), {
        bodyDoubling,
        focusActive: false,
      });
    }
    prevPomodoroPhaseRef.current = pomodoro.phase;
  }, [pomodoro.phase, bodyDoubling, settings.soundsEnabled]);

  useEffect(() => {
    if (
      !isOpen ||
      isLoading ||
      voiceSpeaking ||
      blipVoiceManager.isSpeaking()
    ) {
      return;
    }
    if (userIdleSeconds >= CHAT_TYPING_IDLE_SECONDS) {
      onStateChange("idle");
    } else {
      onStateChange("listening");
    }
  }, [isOpen, isLoading, voiceSpeaking, userIdleSeconds, onStateChange]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener("ari-open-settings", openSettings);
    return () => {
      window.removeEventListener("ari-open-settings", openSettings);
    };
  }, []);

  useEffect(() => {
    if (isOpen && !settingsOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen, settingsOpen]);

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      lastChatClosedAtRef.current = Date.now();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    const messages = messagesRef.current;
    if (!messages) {
      return;
    }
    const nearBottom =
      messages.scrollHeight - messages.scrollTop - messages.clientHeight < 96;
    if (isLoading && hasStreamTokens) {
      messages.scrollTop = messages.scrollHeight;
      return;
    }
    if (nearBottom) {
      messages.scrollTo({
        top: messages.scrollHeight,
        behavior: isLoading ? "auto" : "smooth",
      });
    }
  }, [history, isLoading, error, hasStreamTokens]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveChatHistory(history);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [history]);

  useEffect(() => {
    const lastAssistant = [...history]
      .reverse()
      .find((message) => message.role === "assistant");

    if (lastAssistant?.emotion) {
      onEmotionChange(lastAssistant.emotion);
    }
  }, []);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      if (compareBaseline) compareBaseline.imageBase64 = "";
      if (pendingCrop) pendingCrop.imageBase64 = "";
    },
    [compareBaseline, pendingCrop],
  );

  useEffect(() => {
    if (!compareBaseline) return;
    const timer = window.setTimeout(() => {
      compareBaseline.imageBase64 = "";
      setCompareBaseline(null);
    }, 5 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [compareBaseline]);

  async function fullShutdown() {
    const confirmed = window.confirm(
      settings.llmProvider === "gigachat"
        ? "Ладно. Сворачиваю хвост и ухожу в тень.\n\nПолностью выключить Ari?"
        : "Ладно. Сворачиваю хвост и ухожу в тень.\n\nПолностью выключить Ari и остановить локальный сервер Ollama?",
    );
    if (!confirmed) {
      return;
    }

    saveChatHistory(historyRef.current);
    abortControllerRef.current?.abort();
    setError(null);

    try {
      if (settings.llmProvider === "gigachat") {
        await exitAri();
      } else {
        await stopOllamaAndExit();
      }
    } catch (shutdownError) {
      logError("Full shutdown failed", shutdownError);
      setError(
        shutdownError instanceof Error
          ? shutdownError.message
          : "Не удалось полностью выключить Ari.",
      );
    }
  }

  async function analyzeCapturedWindow(
    capture: ScreenCapture,
    mode: VisionMode,
  ) {
    const { analyzeScreenCapture } = await loadVisionClient();
    const title = capture.title || "без названия";
    const previous = lastVisionObservationRef.current;
    const previousText =
      previous &&
      settings.visualMemoryMinutes > 0 &&
      Date.now() - previous.timestamp <
        settings.visualMemoryMinutes * 60_000
        ? previous.text
        : "";
    const observations = await analyzeScreenCapture(
      capture,
      [
        visionModePrompt(mode),
        previousText
          ? `Предыдущее текстовое наблюдение из временной памяти:\n${previousText}\nИспользуй его только для контекста и не выдавай за содержимое текущего снимка.`
          : "",
      ].filter(Boolean).join("\n\n"),
      settings,
    );
    lastVisionObservationRef.current = rememberVisionObservation(observations);
    recordWorkingEvent({
      kind: "screen_glance",
      app: capture.processName,
      title,
      topic: observations.slice(0, 180),
    });
    const userMessage: ChatMessage = {
      role: "user",
      content: `${visionModeLabels[mode]} в окне «${title}».`,
    };
    const baseHistory = [...historyRef.current, userMessage];
    setHistory([
      ...baseHistory,
      { role: "assistant", content: "", emotion: "curious" },
    ]);
    isLoadingRef.current = false;
    setVisionLoading(false);
    await generateReply(baseHistory, {
      screenObservation: {
        title,
        processName: capture.processName,
        text: observations,
      },
    });
  }

  async function runAutoVisionGlance(): Promise<boolean> {
    if (
      autoVisionBusyRef.current ||
      isLoadingRef.current ||
      visionLoading ||
      !settings.autoVisionEnabled ||
      !settings.activityTrackingEnabled ||
      !activeWindow ||
      !matchesActivityAllowlist(activeWindow, settings.activityAllowlist) ||
      isQuietModeActive(settings, activeWindow) ||
      isQuietHours(settings) ||
      !isVisionProviderOnline(settings, ollamaOnline) ||
      characterStateRef.current !== "idle" ||
      !canUseInitiativeKind("screen_glance")
    ) {
      return false;
    }

    autoVisionBusyRef.current = true;
    try {
      const { captureActiveWindow } = await loadScreenCapture();
      const { analyzeScreenCapture } = await loadVisionClient();
      const capture = await captureActiveWindow();
      const processName = activeWindow.processName || capture.processName;
      const title = capture.title || activeWindow.title || "без названия";
      if (
        !matchesActivityAllowlist(
          { title, processName },
          settings.activityAllowlist,
        )
      ) {
        return false;
      }

      const previous = lastVisionObservationRef.current;
      const previousText =
        previous &&
        settings.visualMemoryMinutes > 0 &&
        Date.now() - previous.timestamp <
          settings.visualMemoryMinutes * 60_000
          ? previous.text
          : "";

      const observations = await analyzeScreenCapture(
        capture,
        [
          AUTO_VISION_GLANCE_PROMPT,
          previousText
            ? `Предыдущее наблюдение:\n${previousText}\nНе выдавай его за текущий снимок.`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        settings,
      );

      lastVisionObservationRef.current = rememberVisionObservation(observations);
      recordWorkingEvent({
        kind: "screen_glance",
        app: processName,
        title,
        topic: observations.slice(0, 180),
      });

      setLastProactiveMessageAt();
      if (settings.proactiveOpenChat) {
        onProactiveMessage();
      }

      const sent = await generateReply(historyRef.current, {
        proactive: true,
        initiativeKind: "screen_glance",
        eventDescription: [
          "Ari редко и любопытно подсмотрела на разрешённый снимок активного окна.",
          "Сформулируй короткую живую реплику: прояви интерес к тому, чем человек занят, без отчёта и без притворства, что видишь экран постоянно.",
        ].join("\n"),
        screenObservation: {
          title,
          processName,
          text: observations,
        },
      });
      if (sent) {
        setLastProactiveMessageAt();
        markInitiativeKind("screen_glance");
        markInitiativeSent(
          lastInitiativeFeaturesRef.current ?? undefined,
          settings.adaptiveInitiativeEnabled,
          "screen_glance",
        );
        return true;
      }
      return false;
    } catch (visionError) {
      logError("Auto vision glance failed", visionError);
      return false;
    } finally {
      autoVisionBusyRef.current = false;
    }
  }

  async function lookAtActiveWindow(
    mode: VisionMode,
    selectRegion = false,
  ) {
    if (isLoadingRef.current || visionLoading) {
      return;
    }

    setVisionMenuOpen(false);
    isLoadingRef.current = true;
    setVisionLoading(true);
    setError(null);
    onStateChange("thinking");
    onEmotionChange("curious");

    let visionPaused = false;

    try {
      const { captureActiveWindow } = await loadScreenCapture();
      const visionClient = await loadVisionClient();
      const capture = await captureActiveWindow();
      if (selectRegion) {
        setPendingCrop(capture);
        visionPaused = true;
        return;
      }
      if (mode === "compare") {
        if (!compareBaseline) {
          setCompareBaseline(capture);
          visionPaused = true;
          return;
        }
        const beforeTitle = compareBaseline.title || "первый снимок";
        const afterTitle = capture.title || "второй снимок";
        const observations = await visionClient.compareScreenCaptures(
          compareBaseline,
          capture,
          visionModePrompt("compare"),
          settings,
        );
        setCompareBaseline(null);
        lastVisionObservationRef.current = rememberVisionObservation(observations);
        const userMessage: ChatMessage = {
          role: "user",
          content: `Сравни снимки «${beforeTitle}» и «${afterTitle}».`,
        };
        const baseHistory = [...historyRef.current, userMessage];
        isLoadingRef.current = false;
        setVisionLoading(false);
        await generateReply(baseHistory, {
          screenObservation: {
            title: `${beforeTitle} → ${afterTitle}`,
            processName: capture.processName,
            text: observations,
          },
        });
        return;
      }
      await analyzeCapturedWindow(capture, mode);
    } catch (visionError) {
      logError("One-shot screen analysis failed", visionError);
      setError(getErrorMessage(visionError, settings.llmProvider));
      playUiSound("error", settings.soundsEnabled, isQuietHours(settings));
      onStateChange("error");
    } finally {
      isLoadingRef.current = false;
      setVisionLoading(false);
      if (!visionPaused) {
        window.setTimeout(
          () => onStateChange(isOpen ? "listening" : "idle"),
          500,
        );
      }
    }
  }

  async function analyzeCrop(
    selection: { x: number; y: number; width: number; height: number },
  ) {
    if (!pendingCrop) return;
    const capture = pendingCrop;
    setPendingCrop(null);
    setVisionLoading(true);
    isLoadingRef.current = true;
    try {
      const { cropScreenCapture } = await loadScreenCapture();
      await analyzeCapturedWindow(
        await cropScreenCapture(capture, selection),
        "overview",
      );
    } catch (cropError) {
      setError(getErrorMessage(cropError, settings.llmProvider));
      playUiSound("error", settings.soundsEnabled, isQuietHours(settings));
      onStateChange("error");
    } finally {
      isLoadingRef.current = false;
      setVisionLoading(false);
      onStateChange(isOpen ? "listening" : "idle");
    }
  }

  function clearHistory() {
    if (isLoading) {
      return;
    }
    if (
      !window.confirm(
        "Очистить историю чата? Сообщения исчезнут, память Ari останется.",
      )
    ) {
      return;
    }

    const clearEmotion = avatarEmotionFromMood(mood);

    setHistory([
      {
        role: "assistant",
        content: "Историю протёрла. Подозрительно чисто.",
        emotion: clearEmotion,
      },
    ]);
    setError(null);
    const now = Date.now();
    markSmalltalkAttemptAt(now);
    markAdviceAttemptAt(now);
    setLastProactiveMessageAt(now);
    onEmotionChange(clearEmotion, "mood");
    onStateChange(isOpen ? "listening" : "idle");
  }

  async function generateReply(
    baseHistory: ChatMessage[],
    options: {
      proactive?: boolean;
      eventDescription?: string;
      initiativeAnchor?: string;
      softInitiativeAnchor?: boolean;
      bannedProactiveTopics?: string[];
      screenObservation?: {
        title: string;
        processName: string;
        text: string;
      };
      initiativeKind?: InitiativeKind;
      proactiveReplyTone?: ProactiveReplyTone;
      advisorAngle?: AdvisorAngle;
      proactiveSignalSummary?: string;
      proactiveLinkNarrative?: string;
      proactivePracticalHook?: string;
      proactiveAdviceSteps?: string[];
      proactiveCodeExcerpt?: { file: string; text: string };
      proactiveInitiativeMove?: string;
      proactiveAdviceCandidateKind?: string;
      proactiveNoveltyGuidance?: string;
    } = {},
  ): Promise<boolean> {
    if (isLoadingRef.current) {
      return false;
    }

    const assistantIndex = baseHistory.length;
    const controller = new AbortController();
    let failed = false;
    let replyEmotion: CharacterEmotion = "neutral";
    let finalReply = "";
    let blipStreamActive = false;
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
    const blipOptions = {
      settings,
      initiative: Boolean(options.proactive) && !proactiveWhileOpen,
      reply: !options.proactive || proactiveWhileOpen,
      technical: false as boolean,
      activeWindow,
      revealOnly: wantAmbientReveal,
      ambientWithSound: wantAmbientReveal && isBlipVoiceEnabled(settings),
      onDisplayUpdate: (displayText: string) => {
        streamedContentRef.current = displayText;
        setHasStreamTokens(displayText.length > 0);
        setHistory((current) =>
          current.map((message, index) =>
            index === assistantIndex
              ? { ...message, content: displayText }
              : message,
          ),
        );
        if (wantAmbientReveal && displayText.trim()) {
          onAmbientBubble?.(displayText.slice(0, 220));
        }
      },
      onSpeakingStart: () => {
        onStateChange("speaking");
      },
      onSpeakingEnd: () => {
        onStateChange(isOpen ? "listening" : "idle");
      },
    };

    let streamEpoch = 0;
    function restartAmbientStream(): void {
      blipVoiceManager.stop();
      blipStreamActive = blipVoiceManager.beginStream(blipOptions);
      if (!blipStreamActive) {
        setStreamingAssistantIndex(assistantIndex);
        setStreamingContent("");
      } else {
        setStreamingAssistantIndex(null);
        setStreamingContent(null);
      }
    }

    restartAmbientStream();

    try {
      const proactiveLlm = options.proactive
        ? await loadProactiveRuntime()
        : null;
      const lastUserMessage = [...baseHistory]
        .reverse()
        .find(({ role }) => role === "user")?.content ?? "";
      const moodTrigger =
        !options.proactive && !options.screenObservation && lastUserMessage
          ? classifyMoodTrigger(lastUserMessage)
          : classifyMoodTrigger("");
      const moodTriggerDescription = describeMoodTrigger(moodTrigger) ?? undefined;
      const moodForReply = moodTriggerDescription
        ? previewMoodAfterTrigger(mood, moodTrigger)
        : mood;
      replyMoodContext = moodForReply;
      if (moodTriggerDescription) {
        onMoodTrigger?.(moodTrigger);
        const hintedEmotion = moodTriggerEmotionHint(moodTrigger);
        if (hintedEmotion) {
          applyReplyEmotion(hintedEmotion);
        }
      }
      const proactiveQuery = [
        options.eventDescription,
        options.initiativeKind,
        lastUserMessage,
        activeWindow?.processName,
        activeWindow?.title,
        "недавний разговор и текущая ситуация пользователя",
      ]
        .filter(Boolean)
        .join(" ");
      const memoryQuery = options.proactive ? proactiveQuery : lastUserMessage;
      const retrieveUserMemory =
        settings.userMemoryEnabled &&
        shouldRetrieveLongTermMemory(memoryQuery, {
          proactive: Boolean(options.proactive),
          ragEnabled: settings.ragEnabled,
        });
      let rawMemory: Awaited<
        ReturnType<Awaited<ReturnType<typeof loadRagClient>>["searchRag"]>
      > = [];
      let rawUserMemory: Awaited<
        ReturnType<typeof selectUserMemoryContext>
      > = { facts: [], summaries: [] as UserMemorySummary[] };
      let episodicMemory: Awaited<
        ReturnType<typeof selectEpisodicContext>
      > = { episodes: [], openLoops: [] };
      if (
        (settings.ragEnabled || retrieveUserMemory) &&
        memoryQuery.trim() &&
        !options.proactive
      ) {
        setLiveToolStatus(
          settings.ragEnabled ? "ищу в документах…" : "читаю память…",
        );
        await yieldToMain();
      }
      type ContextBundle = [
        PromiseSettledResult<
          Awaited<
            ReturnType<Awaited<ReturnType<typeof loadRagClient>>["searchRag"]>
          >
        >,
        PromiseSettledResult<
          Awaited<ReturnType<typeof selectUserMemoryContext>>
        >,
        PromiseSettledResult<
          Awaited<ReturnType<typeof selectEpisodicContext>>
        >,
      ];
      const emptyContextResults: ContextBundle = [
        { status: "fulfilled", value: [] },
        {
          status: "fulfilled",
          value: { facts: [], summaries: [] as UserMemorySummary[] },
        },
        { status: "fulfilled", value: { episodes: [], openLoops: [] } },
      ];
      let contextResults: ContextBundle;
      const ragClient =
        settings.ragEnabled && memoryQuery.trim()
          ? await loadRagClient()
          : null;
      try {
        contextResults = await withTimeout(
          Promise.allSettled([
            ragClient
              ? ragClient.searchRag(memoryQuery, settings)
              : Promise.resolve([]),
            retrieveUserMemory
              ? selectUserMemoryContext(
                  memoryQuery,
                  options.proactive ? 6 : 8,
                  options.proactive ? 2 : 3,
                  settings,
                )
              : Promise.resolve({
                  facts: [],
                  summaries: [] as UserMemorySummary[],
                }),
            retrieveUserMemory
              ? selectEpisodicContext(memoryQuery, settings)
              : Promise.resolve({ episodes: [], openLoops: [] }),
          ]),
          40_000,
          "Сбор контекста",
        );
      } catch (contextError) {
        logError("Context retrieval timed out", contextError);
        contextResults = emptyContextResults;
      }
      if (contextResults[0].status === "fulfilled") {
        rawMemory = contextResults[0].value;
      } else {
        logError("RAG retrieval failed", contextResults[0].reason);
      }
      if (contextResults[1].status === "fulfilled") {
        rawUserMemory = contextResults[1].value;
      } else {
        logError("User memory retrieval failed", contextResults[1].reason);
      }
      if (contextResults[2].status === "fulfilled") {
        episodicMemory = contextResults[2].value;
      } else {
        logError("Episodic memory retrieval failed", contextResults[2].reason);
      }
      const ragMode = ragClient?.getRagSearchMode() ?? "none";
      const memoryMode = getMemorySemanticSearchMode();
      const searchMode: RetrievalSearchMode =
        ragMode === "ivf" || memoryMode === "ivf"
          ? "ivf"
          : ragMode === "linear" || memoryMode === "linear"
            ? "linear"
            : "none";
      let reranked = {
        rag: rawMemory,
        facts: rawUserMemory.facts,
        episodes: episodicMemory.episodes,
      };
      try {
        reranked = await withTimeout(
          applyRetrievalRerank({
            query: memoryQuery,
            settings,
            ragMatches: rawMemory,
            facts: rawUserMemory.facts,
            episodes: episodicMemory.episodes,
            searchMode,
          }),
          15_000,
          "Переранжирование",
        );
      } catch (rerankError) {
        logError("Retrieval rerank failed", rerankError);
      }
      setLiveToolStatus(null);
      const memory = reranked.rag;
      const rerankedFacts = reranked.facts;
      const rerankedEpisodes = reranked.episodes;
      topOpenLoopRef.current = episodicMemory.openLoops[0]?.text;
      const userMemory = {
        facts: dedupeFactsAgainstSummaries(
          rerankedFacts,
          rawUserMemory.summaries,
        ),
        summaries: rawUserMemory.summaries,
      };
      const episodicForPrompt = {
        episodes: rerankedEpisodes,
        openLoops: episodicMemory.openLoops,
      };

      let liveToolContext: string | undefined;
      const ragFound = memory.length > 0;
      const liveToolsModule =
        settings.webToolsEnabled &&
        isLlmProviderOnline(settings, ollamaOnline) &&
        lastUserMessage.trim()
          ? await loadLiveTools()
          : null;
      const needsExplicitTool =
        liveToolsModule?.needsExplicitLiveToolPlanner(lastUserMessage) ?? false;
      const needsWebFallback =
        liveToolsModule?.shouldAutoWebSearch(lastUserMessage, {
        ragEnabled: settings.ragEnabled,
        ragMatchCount: memory.length,
      });
      const proactiveReplyTone =
        options.proactiveReplyTone ??
        (options.proactive && options.initiativeKind
          ? classifyProactiveReplyTone({
              initiativeKind: options.initiativeKind,
              advisorAngle: options.advisorAngle,
              anchor: options.initiativeAnchor,
            })
          : undefined);
      if (
        settings.webToolsEnabled &&
        options.proactive &&
        proactiveReplyTone === "advice" &&
        isLlmProviderOnline(settings, ollamaOnline)
      ) {
        try {
          const proactiveTools = liveToolsModule ?? (await loadLiveTools());
          const proactiveBundle = buildInitiativeSignalBundle(settings, {
            processName: activeWindow?.processName,
            windowTitle: activeWindow?.title,
          });
          if (
            shouldProactiveWebSearch(
              proactiveBundle,
              proactiveReplyTone,
              settings,
              options.initiativeAnchor,
              options.proactiveAdviceCandidateKind,
            )
          ) {
            const query = buildProactiveWebSearchQuery(
              proactiveBundle,
              options.initiativeAnchor,
            );
            setLiveToolStatus("ищу в интернете…");
            const raw = await withTimeout(
              proactiveTools.runLiveTool({ tool: "web_search", query }, settings),
              30_000,
              "Проактивный поиск",
            );
            liveToolContext = proactiveTools.formatLiveToolContext(
              { tool: "web_search", query },
              raw,
            );
          }
        } catch (toolError) {
          logError("Proactive web search failed", toolError);
        } finally {
          setLiveToolStatus(null);
        }
      }
      if (
        liveToolsModule &&
        settings.webToolsEnabled &&
        !options.proactive &&
        isLlmProviderOnline(settings, ollamaOnline) &&
        lastUserMessage.trim() &&
        (needsExplicitTool || (!ragFound && needsWebFallback))
      ) {
        try {
          let plan: LiveToolPlan | null = null;
          if (needsExplicitTool) {
            plan = await liveToolsModule.planLiveToolUse(lastUserMessage, settings);
          }
          if (!plan && needsWebFallback && !ragFound) {
            plan = {
              tool: "web_search" as const,
              query: lastUserMessage.trim().slice(0, 200),
            };
          }
          if (plan) {
            if (plan.tool === "web_search") {
              setLiveToolStatus("ищу в интернете…");
            }
            const raw = await liveToolsModule.runLiveTool(plan, settings);
            liveToolContext = liveToolsModule.formatLiveToolContext(plan, raw);
          }
        } catch (toolError) {
          logError("Live tool failed", toolError);
        } finally {
          setLiveToolStatus(null);
        }
      }

      const moodStyle = isMoodEngineEnabled(settings)
        ? moodVectorToPrompt(getCurrentMoodVector().vector)
        : null;
      const moodPrompt = moodStyle?.promptModifier ?? describeMoodForPrompt(moodForReply);
      const responseLength = chooseResponseLength(
        lastUserMessage,
        memory.length,
        Boolean(options.proactive),
        proactiveReplyTone,
        moodForReply,
        moodStyle?.responseParams,
      );
      const responseMode = classifyResponseMode({
        message: lastUserMessage,
        proactive: options.proactive,
        screenObservation: Boolean(options.screenObservation),
        eventDescription: options.eventDescription,
        initiativeKind: options.initiativeKind,
        proactiveReplyTone,
        useIntentClassifier: settings.intentClassifierEnabled,
      });
      blipOptions.technical = responseMode === "technical_help";
      const relationshipToneKey = deriveRelationshipTone(relationship, moodForReply);
      const relationshipTone = describeRelationshipTone(relationshipToneKey);
      const recentPhrases = buildAvoidPhrases();
      const recentAssistantReplies = baseHistory
        .filter((message) => message.role === "assistant")
        .map((message) => message.content)
        .slice(-5);
      const workSession = describeActiveFocusSession(getActiveFocusSession());
      const userAskedQuestion =
        liveToolsModule?.isQuestionLikeMessage(lastUserMessage) ?? false;
      const validationContext = {
        hasVision: Boolean(options.screenObservation),
        hasMemory:
          userMemory.facts.length > 0 ||
          userMemory.summaries.length > 0 ||
          episodicForPrompt.episodes.length > 0 ||
          episodicForPrompt.openLoops.length > 0 ||
          Boolean(describeAriSelfMemory(selfMemory)),
        hasRag: memory.length > 0,
        hasLiveTool: Boolean(liveToolContext),
        userAskedQuestion,
        proactive: Boolean(options.proactive),
        proactiveReplyTone,
        responseMode,
        moodArchetype: deriveMoodArchetype(moodForReply),
        hasDebugSignals:
          Boolean(options.proactive) &&
          proactiveReplyTone === "advice" &&
          hasProactiveDebugSignals(
            buildInitiativeSignalBundle(settings, {
              processName: activeWindow?.processName,
              windowTitle: activeWindow?.title,
            }),
          ),
        proactiveInitiativeMove: options.proactiveInitiativeMove,
      };
      const processReplyOptions = {
        responseMode,
        validationContext,
        streamedEmotion: replyEmotion,
        recentAssistantReplies,
        proactive: Boolean(options.proactive),
        userAskedQuestion,
      };
      const emotionGuidance = describeEmotionAntiRepeat(moodForReply);
      let runtimeContext: RuntimeContext = {
        memory,
        activeWindow,
        proactive: options.proactive,
        userFacts: userMemory.facts.map(({ text }) => text),
        userFactDetails: userMemory.facts.map(
          ({ text, importance, confidence }) => ({
            text,
            importance,
            confidence,
          }),
        ),
        memorySummaries: userMemory.summaries.map(({ title, text }) => ({
          title,
          text,
        })),
        episodes: episodicForPrompt.episodes,
        openLoops: episodicForPrompt.openLoops,
        eventDescription: options.eventDescription,
        initiativeAnchor: options.initiativeAnchor,
        softInitiativeAnchor: options.softInitiativeAnchor,
        bannedProactiveTopics: options.bannedProactiveTopics,
        mood: moodPrompt,
        relationship: `${describeRelationship(
          relationship,
        )}. ${describeBondForPrompt(relationship, settings.romanceMode)}; тон: ${relationshipTone}`,
        relationshipToneConstraints:
          describeRelationshipToneConstraints(relationshipToneKey),
        attention: describeAttention(attention),
        routine: describeRoutineContext(),
        scene: describePresenceScene(scene),
        safeActionsAvailable: settings.safeActionsEnabled,
        responseMode,
        selfMemory: [describeAriSelfMemory(selfMemory), describeReactionLearningSummary()]
          .filter(Boolean)
          .join(". "),
        initiativeKind: options.initiativeKind,
        proactiveReplyTone,
        responseLength,
        screenObservation: options.screenObservation,
        avoidPhrases: recentPhrases,
        emotionGuidance: emotionGuidance ?? undefined,
        workSession,
        behaviorSettings:
          buildUserBehaviorBlock(settings, describePreferenceRules()) ||
          undefined,
        workingMemory: describeWorkingMemory() || undefined,
        conversationMemory: describeConversationMemory() || undefined,
        moodTrigger: moodTriggerDescription,
        liveToolContext,
        projectPinnedContext: describePinnedProjectContext() || undefined,
        goalLedger: formatGoalLedgerForPrompt() || undefined,
        proactiveSignalSummary: options.proactiveSignalSummary,
        proactiveLinkNarrative: options.proactiveLinkNarrative,
        proactivePracticalHook: options.proactivePracticalHook,
        proactiveAdviceSteps: options.proactiveAdviceSteps,
        proactiveCodeExcerpt: options.proactiveCodeExcerpt,
        proactiveInitiativeMove: options.proactiveInitiativeMove,
        proactiveNoveltyGuidance: options.proactiveNoveltyGuidance,
      };
      const fittedBundle = buildTrimmedPromptContext(
        baseHistory,
        runtimeContext,
        settings,
      );
      const fittedHistory = fittedBundle.fittedHistory;
      runtimeContext = fittedBundle.runtimeContext;
      if (fittedBundle.trimNotes.length) {
        fittedBundle.trimNotes.forEach((note) => recordContextTrim(note));
        ariLog("prompt-context", "debug", {
          contextTrim: fittedBundle.trimNotes.join(", "),
        });
      }
      const tokenEstimate = Math.ceil(
        (fittedHistory.reduce(
          (total, message) => total + message.content.length,
          0,
        ) +
          memory.reduce((total, fragment) => total + fragment.text.length, 0) +
          userMemory.facts.reduce(
            (total, fact) => total + fact.text.length,
            0,
          )) /
          4,
      );
      ariLog("prompt-context", "debug", {
        provider: settings.llmProvider,
        responseMode,
        relationshipTone,
        moodSummary: describeMoodForPrompt(mood),
        scene,
        memoryCount: userMemory.facts.length,
        episodeCount: episodicForPrompt.episodes.length,
        ragCount: memory.length,
        tokenEstimate,
        finalUserMessage: lastUserMessage.slice(0, 120),
        initiativeReason: options.eventDescription,
      });
      ariLog("runtime", "debug", {
        emotion: replyEmotion,
        visualState: "thinking",
        responseMode,
        lastInitiative: options.eventDescription,
      });

      async function clearVisibleStreamDraft(): Promise<void> {
        if (streamUiTimerRef.current) {
          window.clearTimeout(streamUiTimerRef.current);
          streamUiTimerRef.current = null;
        }
        streamedContentRef.current = "";
        pendingStreamContentRef.current = "";
        setHasStreamTokens(false);
        setStreamingContent(null);
        setStreamingAssistantIndex(assistantIndex);
        setHistory((current) =>
          current.map((message, index) =>
            index === assistantIndex ? { ...message, content: "" } : message,
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
        if (epoch > 1 && wantAmbientReveal && revealToUser) {
          restartAmbientStream();
        }
        return withTimeout(
          streamLlm(
            messages,
            settings,
            (streamedContent) => {
              if (epoch !== streamEpoch) {
                return;
              }
              streamedContentRef.current = streamedContent;
              if (!revealToUser) {
                return;
              }
              if (blipStreamActive) {
                blipVoiceManager.feedStream(streamedContent, replyEmotion);
                if (streamedContent) {
                  setHasStreamTokens(true);
                  setHistory((current) =>
                    current.map((message, index) =>
                      index === assistantIndex
                        ? { ...message, content: streamedContent }
                        : message,
                    ),
                  );
                }
                return;
              }

              if (streamedContent) {
                setHasStreamTokens(true);
                onStateChange("speaking");
              }

              scheduleThrottledStreamUpdate(
                streamedContent,
                streamUiTimerRef,
                pendingStreamContentRef,
                (value) => {
                  setStreamingContent(value);
                  if (wantAmbientReveal && value.trim()) {
                    onAmbientBubble?.(value.slice(0, 220));
                  }
                },
              );
            },
            (emotion) => {
              if (epoch !== streamEpoch) {
                return;
              }
              if (!revealToUser) {
                return;
              }
              replyEmotion = emotion;
              setHistory((current) =>
                current.map((message, index) =>
                  index === assistantIndex
                    ? { ...message, emotion }
                    : message,
                ),
              );
            },
            controller.signal,
          ),
          180_000,
          "Генерация ответа",
        );
      }

      let reply = await runStream(buildMessages(fittedHistory, runtimeContext));
      let processed = processModelReply(reply, processReplyOptions);
      processed = trySoftenTrailingQuestionReply(processed, processReplyOptions);

      const shouldValidateProactiveWithLlm =
        options.proactive &&
        isLlmProviderOnline(settings, ollamaOnline) &&
        settings.llmProvider !== "gigachat";
      if (shouldValidateProactiveWithLlm) {
        const proactiveBundle = proactiveLlm?.getLastProactiveLlmBundle();
        const proactiveFacts = proactiveLlm?.getLastProactiveSignalFacts() ?? [];
        const maxProactiveRegens =
          settings.llmProvider === "gigachat"
            ? proactiveReplyTone === "advice"
              ? 1
              : 0
            : 2;
        for (let attempt = 0; attempt <= maxProactiveRegens; attempt += 1) {
          if (!proactiveBundle || !processed.content.trim()) {
            break;
          }
          const quality = await proactiveLlm!.validateProactiveReplyLlm(
            settings,
            proactiveBundle,
            processed.content,
            proactiveFacts,
          );
          if (quality.acceptable) {
            break;
          }
          if (attempt >= maxProactiveRegens) {
            processed = {
              ...processed,
              validation: {
                valid: false,
                issues: [
                  ...processed.validation.issues.filter(
                    (issue) => issue !== "proactive quality",
                  ),
                  "proactive quality",
                ],
              },
            };
            break;
          }
          const correctionIssues = [
            ...processed.validation.issues.filter(
              (issue) => issue !== "proactive quality",
            ),
            ...(quality.issues.includes("proactive meta commentary")
              ? ["proactive meta commentary"]
              : []),
            ...(quality.issues.includes("missing fact quote")
              ? ["proactive quality"]
              : []),
            "proactive quality",
          ];
          const correctionHistory: ChatMessage[] = [
            ...fittedHistory,
            { role: "assistant", content: reply },
            {
              role: "user",
              content: buildCorrectionUserMessage(
                [...new Set(correctionIssues)],
              ),
            },
          ];
          try {
            await clearVisibleStreamDraft();
            reply = await runStream(
              buildMessages(correctionHistory, runtimeContext),
              { revealToUser: false },
            );
            processed = processModelReply(reply, processReplyOptions);
            processed = trySoftenTrailingQuestionReply(
              processed,
              processReplyOptions,
            );
          } catch (retryError) {
            logError("Proactive reply regen failed", retryError);
            break;
          }
        }
      }

      if (
        options.proactive &&
        proactiveReplyTone === "advice" &&
        settings.llmProvider === "gigachat" &&
        processed.content.trim()
      ) {
        const proactiveBundle = proactiveLlm?.getLastProactiveLlmBundle();
        const proactiveFacts = proactiveLlm?.getLastProactiveSignalFacts() ?? [];
        if (proactiveBundle) {
          const localQuality = proactiveLlm!.localReplyQualityCheck(
            proactiveBundle,
            processed.content,
            proactiveFacts,
          );
          if (
            localQuality &&
            (localQuality.issues.includes("single-factor generic") ||
              localQuality.issues.includes("thin-context generic") ||
              localQuality.issues.includes("missing clipboard quote"))
          ) {
            const clarifying = buildVisibleClarifyingFallback(
              proactiveFacts,
              proactiveBundle,
            );
            if (clarifying) {
              processed = {
                content: clarifying,
                emotion:
                  processed.emotion === "neutral"
                    ? "curious"
                    : processed.emotion,
                validation: {
                  valid: true,
                  issues: processed.validation.issues.filter(
                    (issue) => issue !== "single-factor generic",
                  ),
                },
              };
            }
          }
        }
      }

      if (shouldRetryReply(processed.validation)) {
        const firstProcessed = processed;
        ariLog("reply-meta", "debug", {
          oocValidation: `retry: ${processed.validation.issues.join(", ")}`,
          responseMode,
        });
        const correctionHistory: ChatMessage[] = [
          ...fittedHistory,
          { role: "assistant", content: reply },
          {
            role: "user",
            content: buildCorrectionUserMessage(processed.validation.issues),
          },
        ];
        try {
          await clearVisibleStreamDraft();
          reply = await runStream(
            buildMessages(correctionHistory, runtimeContext),
            { revealToUser: false },
          );
          const retryProcessed = processModelReply(reply, processReplyOptions);
          const softenedRetry = trySoftenTrailingQuestionReply(
            retryProcessed,
            processReplyOptions,
          );
          processed =
            softenedRetry.content.trim() || !firstProcessed.content.trim()
              ? softenedRetry
              : firstProcessed;
        } catch (retryError) {
          if (firstProcessed.content.trim()) {
            logError("Reply correction failed, using first reply", retryError);
            processed = firstProcessed;
          } else {
            throw retryError;
          }
        }
      }

      if (
        !options.proactive &&
        shouldRetryReply(processed.validation) &&
        processed.validation.issues.includes("habitual trailing question")
      ) {
        const beforeSecondRetry = processed;
        const correctionHistory: ChatMessage[] = [
          ...fittedHistory,
          { role: "assistant", content: reply },
          {
            role: "user",
            content: buildCorrectionUserMessage(processed.validation.issues),
          },
        ];
        try {
          await clearVisibleStreamDraft();
          reply = await runStream(
            buildMessages(correctionHistory, runtimeContext),
            { revealToUser: false },
          );
          const secondRetry = processModelReply(reply, processReplyOptions);
          const softenedSecond = trySoftenTrailingQuestionReply(
            secondRetry,
            processReplyOptions,
          );
          processed =
            softenedSecond.content.trim() || !beforeSecondRetry.content.trim()
              ? softenedSecond
              : beforeSecondRetry;
        } catch (retryError) {
          if (beforeSecondRetry.content.trim()) {
            logError(
              "Second trailing-question correction failed, using prior reply",
              retryError,
            );
            processed = beforeSecondRetry;
          } else {
            throw retryError;
          }
        }
      }

      if (
        shouldRetryReply(processed.validation) &&
        shouldUseInCharacterFallback(processed.validation)
      ) {
        processed = buildInCharacterFallback();
      }

      if (
        options.proactive &&
        proactiveReplyTone === "advice" &&
        shouldSuppressProactiveReply(processed.validation.issues)
      ) {
        const fallback = await resolveAdviceVisibleFallbackAsync({
          practicalHook: options.proactivePracticalHook,
          linkNarrative: options.proactiveLinkNarrative,
          signalSummary: options.proactiveSignalSummary,
          activeWindow,
        });
        if (fallback) {
          processed = {
            content: fallback,
            emotion:
              processed.emotion === "neutral" ? "curious" : processed.emotion,
            validation: {
              valid: true,
              issues: processed.validation.issues.filter(
                (issue) =>
                  issue !== "proactive quality" &&
                  issue !== "duplicate proactive reply",
              ),
            },
          };
        }
      }

      if (
        options.proactive &&
        proactiveReplyTone === "advice" &&
        processed.content.trim()
      ) {
        const proactiveBundle = proactiveLlm?.getLastProactiveLlmBundle();
        const proactiveFacts = proactiveLlm?.getLastProactiveSignalFacts() ?? [];
        if (proactiveBundle) {
          const finalGate = runAdviceFinalGate({
            text: processed.content,
            bundle: proactiveBundle,
            facts: proactiveFacts,
          });
          if (finalGate.status === "repaired") {
            const repairedValidation = validateCharacterReply(finalGate.text, {
              ...processReplyOptions.validationContext,
              responseMode,
              proactive: processReplyOptions.proactive,
              userAskedQuestion: processReplyOptions.userAskedQuestion,
              recentAssistantReplies: processReplyOptions.recentAssistantReplies,
              proactiveInitiativeMove: options.proactiveInitiativeMove,
            });
            processed = {
              content: finalGate.text,
              emotion:
                processed.emotion === "neutral" ? "curious" : processed.emotion,
              validation: {
                valid: repairedValidation.valid,
                issues: repairedValidation.valid
                  ? []
                  : [
                      ...new Set([
                        ...repairedValidation.issues,
                        "proactive quality",
                      ]),
                    ],
              },
            };
          } else if (finalGate.status === "rejected") {
            processed = {
              ...processed,
              validation: {
                valid: false,
                issues: [
                  ...new Set([
                    ...processed.validation.issues,
                    "proactive quality",
                  ]),
                ],
              },
            };
          }
        }
      }

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
          processName: activeWindowRef.current?.processName,
          windowTitle: activeWindowRef.current?.title,
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
            processName: activeWindowRef.current?.processName,
            windowTitle: activeWindowRef.current?.title,
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
        oocValidation: processed.validation.valid
          ? "passed"
          : processed.validation.issues.join(", "),
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

      if (
        !options.proactive &&
        !options.screenObservation &&
        lastUserMessage
      ) {
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
            const { autoCommitted, inboxed } = await applyExtractedFacts(
              facts,
              lastUserMessage,
            );
            if (autoCommitted || inboxed) {
              const parts: string[] = [];
              if (autoCommitted) {
                parts.push(`${autoCommitted} в факты`);
              }
              if (inboxed) {
                parts.push(`${inboxed} во входящие`);
              }
            }
            if (countPendingMemoryInboxItems() >= 3 && !isQuietModeActive(settings, activeWindow)) {
              setHistory((current) => [
                ...current,
                {
                  role: "assistant",
                  content:
                    "Есть кандидаты в память — загляни во «Входящие» в настройках.",
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
                  ? "Напоминание — требует подтверждения"
                  : "Автоизвлечение open loop",
                metadata: loop.dueAt
                  ? { dueAt: String(loop.dueAt) }
                  : undefined,
              });
            }
            await resolveOpenLoops(resolvedLoopIds);
          })
          .catch((postprocessError: unknown) => {
            logError("Conversation memory postprocess failed", postprocessError);
          });
      }
    } catch (requestError) {
      if (isAbortError(requestError)) {
        if (blipStreamActive) {
          blipVoiceManager.stop();
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
          onEmotionChange("surprised", options.proactive ? "initiative" : "model");
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
        if (blipStreamActive) {
          await blipVoiceManager.endStreamAsync(finalReply);
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
  }

  function insertQuickCommand(value: string): void {
    setInput(value);
    setQuickCommandOpen(false);
    recordChatTyping();
    lastUserActivityRef.current = Date.now();
    lastTypingDispatchRef.current = Date.now();
    window.dispatchEvent(new CustomEvent(ARI_USER_TYPING_EVENT));
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }

  async function runPcReactionInitiative(
    kind: PcEventKind,
    fallbackScenario: Scenario,
    ctx: Parameters<typeof resolveScenario>[1],
  ): Promise<boolean> {
    const plan = consumePcReaction(kind, { chatOpen: isOpen });
      if (plan?.spokenHint && plan.initiativeKind) {
      const bundleOpts: ProactivePackageOptions = {
        sessionMinutes: ctx.previousWindowMinutes ?? 0,
        windowMinutes: ctx.previousWindowMinutes ?? 0,
        processName: ctx.processName,
        windowTitle: ctx.windowTitle,
        visionObservation: lastVisionObservationRef.current,
      };
      const pkg = buildProactiveInitiativePackage(
        settings,
        plan.initiativeKind,
        {
          ...proactiveBundleOptions(bundleOpts),
          eventHint: plan.spokenHint,
          eventLabel: plan.spokenHint,
        },
      );
      return (await launchProactiveInitiative(pkg)).sent;
    }
    return runScenarioInitiative(fallbackScenario, ctx);
  }

  async function runScenarioInitiative(
    scenario: Scenario,
    ctx: Parameters<typeof resolveScenario>[1],
  ): Promise<boolean> {
    const outcome = resolveScenario(scenario, ctx);
    if (outcome.kind === "initiative") {
      const pkg = buildProactiveInitiativePackage(
        settings,
        outcome.initiativeKind,
        {
          ...proactiveBundleOptions({
            processName: ctx.processName,
            windowTitle: ctx.windowTitle,
          }),
          eventHint: outcome.description,
        },
      );
      const { sent } = await launchProactiveInitiative(pkg);
      if (sent) {
        markScenarioTriggered(scenario);
      }
      return sent;
    }
    if (outcome.kind === "local") {
      if (isLlmProviderOnline(settings, ollamaOnline)) {
        const pkg = buildProactiveInitiativePackage(settings, "check_in", {
          ...proactiveBundleOptions({
            processName: ctx.processName,
            windowTitle: ctx.windowTitle,
          }),
          eventHint: [
            "Реакция на сценарий — своя короткая реплика Ari, не копируй шаблон дословно.",
            `Ориентир по тону: ${outcome.line}`,
          ].join("\n"),
        });
        const { sent } = await launchProactiveInitiative(pkg);
        if (sent) {
          markScenarioTriggered(scenario);
          return true;
        }
      }
      recordInitiativeSuppressed("scenario local line skipped without LLM");
      return false;
    }
    return false;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = input.trim();
    if (!content || isLoading) {
      return;
    }

    if (teachMode) {
      parsePreferenceRule(content);
      setInput("");
      setTeachMode(false);
      setHistory((current) => [
        ...current,
        {
          role: "assistant",
          content: "Запомнила. Это правило появится в настройках Teach Ari.",
          emotion: "happy",
        },
      ]);
      return;
    }

    const commandResult = await tryHandleChatCommand(content, settings, mood);
    if (commandResult.handled) {
      setInput("");
      setHistory((current) => [
        ...current,
        { role: "user", content },
        {
          role: "assistant",
          content: commandResult.reply,
          emotion: commandResult.emotion,
        },
      ]);
      return;
    }

    lastRetryMessageRef.current = content;
    recordWorkingEvent({
      kind: "chat_question",
      topic: `Спросил в чате: ${content.slice(0, 160)}`,
    });
    if (settings.advisorEnabled) {
      recordQueryTopic({ topic: content.slice(0, 160), source: "chat" });
    }
    const nextHistory: ChatMessage[] = [
      ...history,
      { role: "user", content },
    ];

    lastUserActivityRef.current = Date.now();
    recordChatTyping();
    recordCompanionInteraction();
    flushChatTypingPersist();
    recordUserAcknowledgedInitiative();
    recordConversationMoment();
    setInput("");
    await generateReply(nextHistory);
  }

  async function repeatLastReply() {
    if (
      isLoading ||
      history[history.length - 1]?.role !== "assistant"
    ) {
      return;
    }

    await generateReply(history.slice(0, -1));
  }

  const canRepeat =
    !isLoading && history[history.length - 1]?.role === "assistant";
  const canClear = !isLoading && history.length > 0;

  function updateAction(
    actionId: string,
    update: Partial<SafeActionProposal>,
  ) {
    setHistory((current) =>
      current.map((message) =>
        message.action?.id === actionId
          ? { ...message, action: { ...message.action, ...update } }
          : message,
      ),
    );
  }

  async function approveAction(action: SafeActionProposal) {
    if (shouldMoodRefuseRequest(mood, "action")) {
      updateAction(action.id, {
        status: "rejected",
        result: buildMoodRefusalReply(mood, "action"),
      });
      return;
    }
    updateAction(action.id, { status: "running", result: "Выполняю…" });
    const safeActions = await loadSafeActions();
    try {
      const result = await safeActions.executeSafeAction(action, settings, {
        startFocus: (input) => {
          ensureGoalForFocus(input.goal);
          startProductivityFocus(input);
          playUiSound("pomodoro-start", settings.soundsEnabled, isQuietHours(settings), {
            focusActive: true,
          });
        },
        stopFocus: () => stopFocusSessionFlow(),
        pausePomodoro: () => pausePomodoro(),
        resumePomodoro: () => resumePomodoro(),
      });
      updateAction(action.id, { status: "approved", result });
    } catch (actionError) {
      const result =
        actionError instanceof Error
          ? actionError.message
          : String(actionError);
      safeActions.logFailedAction(action, result);
      updateAction(action.id, { status: "failed", result });
    }
  }

  function rejectAction(action: SafeActionProposal) {
    void loadSafeActions().then((safeActions) => {
      safeActions.logRejectedAction(action);
    });
    updateAction(action.id, {
      status: "rejected",
      result: "Действие отменено.",
    });
  }

  async function launchAdviceFromEngine(
    decision: AdviceDecision,
    plannedSilenceMs: number,
    urgency: ReturnType<typeof scoreAdviceUrgency>,
  ): Promise<boolean> {
    if (!decision.package || !decision.deliver) {
      recordAdviceDecision(`engine -> ${decision.strategy}: ${decision.reason}`);
      return false;
    }
    const launch = await launchProactiveInitiative(decision.package, {
      ignoreKindDailyCap: true,
      kindCooldownMs: urgency.effectiveIntervalMs,
      plannedCheckMinSilenceMs: plannedSilenceMs,
      engineApproved: decision.engineApproved,
    });
    if (launch.sent) {
      const subject =
        urgency.subjectKey ?? decision.package.initiativeAnchor;
      if (subject) {
        rememberAdviceSubject(subject);
      }
      recordAdviceDecision(`engine -> sent (${decision.strategy})`);
    } else {
      recordAdviceDecision(
        launch.suppressReason
          ? `engine -> launch failed: ${launch.suppressReason}`
          : `engine -> launch failed (${decision.strategy})`,
      );
    }
    return launch.sent;
  }

  async function tryGenericCompanionInitiative(input: {
    activityAgoMs: number;
    intervalMs: number;
    plannedSilenceMs: number;
    llmOnline: boolean;
    immersedCompanion: boolean;
    companionSilenceMs: number;
  }): Promise<boolean> {
    if (
      !allowsGenericCompanionInitiative(
        input.activityAgoMs,
        input.plannedSilenceMs,
        {
          immersedCompanion: input.immersedCompanion,
          companionSilenceMs: input.companionSilenceMs,
          companionSilenceMinMs: COMPANION_SILENCE_MIN_MS,
        },
      )
    ) {
      return false;
    }

    const kindCooldownMs = input.intervalMs;
    if (!canUseInitiativeKind("check_in", { cooldownMs: kindCooldownMs })) {
      return false;
    }

    if (input.llmOnline) {
      let pkg = await prepareProactivePackage("check_in", proactiveBundleOptions());
      if (!pkg) {
        pkg = buildProactiveInitiativePackage(
          settings,
          "check_in",
          proactiveBundleOptions(),
        );
      }
      if (!pkg) {
        return false;
      }
      const { sent } = await launchProactiveInitiative(pkg, {
        kindCooldownMs,
        plannedCheckMinSilenceMs: input.plannedSilenceMs,
      });
      return sent;
    }

    recordInitiativeSuppressed("llm offline");
    return false;
  }

  function getProactiveTiming(now = Date.now()) {
    const windowMs = observedWindowRef.current
      ? now - observedWindowRef.current.since
      : 0;
    const sessionMs = codingSessionMs(codingSessionRef.current, now);
    return {
      windowMs,
      sessionMs,
      windowMinutes: Math.round(windowMs / 60_000),
      sessionMinutes: codingSessionMinutes(codingSessionRef.current, now),
    };
  }

  function proactiveBundleOptions(
    extra: ProactivePackageOptions = {},
  ): ProactivePackageOptions {
    const timing = getProactiveTiming();
    const recentTurns = historyRef.current
      .slice(-4)
      .filter(
        (
          message,
        ): message is { role: "user" | "assistant"; content: string } =>
          message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
    const lastUserMessage = [...historyRef.current]
      .reverse()
      .find((message) => message.role === "user")?.content;
    return {
      sessionMinutes: timing.sessionMinutes,
      windowMinutes: timing.windowMinutes,
      processName: activeWindowRef.current?.processName,
      windowTitle: activeWindowRef.current?.title,
      visionObservation: lastVisionObservationRef.current,
      companionSilenceMs: getCompanionSilenceMs(),
      codingSessionMinutes: timing.sessionMinutes,
      recentUserMessage: lastUserMessage,
      recentChatTurns: recentTurns,
      urgency: extra.urgency ?? getLastAdviceUrgency() ?? undefined,
      ...extra,
    };
  }

  async function prepareProactivePackage(
    kind: InitiativeKind,
    options: ProactivePackageOptions = {},
  ): Promise<ProactiveInitiativePackage | null> {
    const backoff = getProactiveFailureBackoff();
    if (backoff) {
      recordInitiativeSuppressed(
        `proactive backoff ${Math.ceil((backoff.until - Date.now()) / 60_000)}m`,
      );
      return null;
    }
    if (!isOpen && isLlmProviderOnline(settings, ollamaOnline)) {
      onAmbientBubble?.("…");
    }
    const mergedOpts = proactiveBundleOptions(options);
    const bundle = buildInitiativeSignalBundle(settings, mergedOpts);
    const banned = collectBannedProactiveTopics();
    const candidateTopics =
      options.conversationTopics ??
      (kind === "check_in" || kind === "process_advice"
        ? buildConversationTopics(bundle.advisor, 6, banned, bundle)
        : []);

    let packageOptions: ProactivePackageOptions = {
      ...mergedOpts,
      ...options,
      conversationTopics: candidateTopics,
    };

    if (isLlmProviderOnline(settings, ollamaOnline)) {
      const existingBundle = options.llmBundle;
      if (existingBundle) {
        if (!existingBundle.shouldSend) {
          recordInitiativeSuppressed(
            existingBundle.rejectReason ?? "llm bundle rejected",
          );
          return null;
        }
        packageOptions = {
          ...packageOptions,
          conversationTopics:
            existingBundle.linkedThemes.length > 0
              ? existingBundle.linkedThemes
              : candidateTopics,
          llmBundle: existingBundle,
        };
      } else {
      const proactive = await loadProactiveRuntime();
      const preliminaryAnchor =
        pickPlannedInitiativeAnchor(candidateTopics, {
          recentProactive: banned,
          windowTitle: mergedOpts.windowTitle,
          dominantFile: bundle.editorFile,
        }) ?? candidateTopics[0];
      const tone = classifyProactiveReplyTone({
        initiativeKind: kind,
        advisorAngle: options.advisorAngle,
        anchor: preliminaryAnchor,
        bundle,
        conversationTopics: candidateTopics,
        urgencyLevel: mergedOpts.urgency?.level,
      });
      let ragSnippets: string[] = [];
      if (
        settings.ragEnabled &&
        tone === "advice" &&
        (hasProactiveDebugSignals(bundle) ||
          bundle.clipboardSnippets.length > 0 ||
          bundle.advisor.activitySummary.inputFrictionScore >= 1)
      ) {
        try {
          const ragQuery = buildProactiveWebSearchQuery(
            bundle,
            preliminaryAnchor,
          );
          const ragClient = await loadRagClient();
          const ragHits = await ragClient.searchRag(ragQuery, settings);
          ragSnippets = ragHits
            .slice(0, 3)
            .map((hit) => hit.text.trim().slice(0, 420))
            .filter(Boolean);
        } catch {
          ragSnippets = [];
        }
      }
      const codeExcerpt =
        tone === "advice" ? await loadCurrentCodeExcerpt(settings, bundle) : null;
      const adviceFacts = proactive.collectProactiveSignalFacts({
        bundle,
        tone,
        bannedTopics: banned,
        candidateTopics,
        sessionMinutes: mergedOpts.sessionMinutes,
        windowMinutes: mergedOpts.windowMinutes,
        companionSilenceMs: mergedOpts.companionSilenceMs,
        recentUserMessage: mergedOpts.recentUserMessage,
        urgency: mergedOpts.urgency,
        recentChatTurns: mergedOpts.recentChatTurns,
        ragSnippets: ragSnippets.length ? ragSnippets : undefined,
        codeExcerpts: codeExcerpt
          ? [{ file: codeExcerpt.file, text: codeExcerpt.text }]
          : undefined,
      });
      const adviceTopicKey = buildAdviceTopicKey({
        anchor: preliminaryAnchor,
        processName: mergedOpts.processName,
        windowTitle: mergedOpts.windowTitle,
        signalSummary: mergedOpts.urgency?.reasons.join("; "),
      });
      if (tone === "advice") {
        reconcilePendingAdviceOutcomes({
          afterState: buildAdviceObservedState({
            topicKey: adviceTopicKey,
            bundle,
            facts: adviceFacts,
            processName: mergedOpts.processName,
            windowTitle: mergedOpts.windowTitle,
          }),
        });
      }
      const advicePlan =
        tone === "advice"
          ? planAdvice({
              bundle,
              facts: adviceFacts,
              urgency: mergedOpts.urgency,
              feedback: getRecentAdviceFeedback(adviceTopicKey),
              history: loadAdviceLedger(),
              outcomes: getRecentAdviceOutcomes(adviceTopicKey),
              candidateTopics,
              ragSnippets,
            })
          : null;
      if (tone === "advice" && !advicePlan?.selected) {
        const hasGroundingFacts = adviceFacts.some((fact) =>
          [
            "clipboard",
            "file",
            "urgency",
            "task",
            "query",
            "screen",
            "wm",
            "reference",
            "hypothesis",
          ].includes(fact.kind),
        );
        const urgencyLevel = mergedOpts.urgency?.level;
        const hasAdviceAnchor =
          Boolean(preliminaryAnchor?.trim()) || candidateTopics.length > 0;
        const bypassPlannerGate =
          urgencyLevel === "medium" ||
          urgencyLevel === "high" ||
          (kind === "process_advice" && hasAdviceAnchor);
        if (kind !== "check_in" && !hasGroundingFacts && !bypassPlannerGate) {
          recordInitiativeSuppressed(
            advicePlan?.reason ?? "advice planner rejected repeated advice",
          );
          return null;
        }
      }
      let llmBundle = await proactive.synthesizeProactiveBundle(settings, {
        bundle,
        tone,
        bannedTopics: banned,
        candidateTopics,
        sessionMinutes: mergedOpts.sessionMinutes,
        windowMinutes: mergedOpts.windowMinutes,
        companionSilenceMs: mergedOpts.companionSilenceMs,
        recentUserMessage: mergedOpts.recentUserMessage,
        urgency: mergedOpts.urgency,
        recentChatTurns: mergedOpts.recentChatTurns,
        llmOnline: true,
        ragSnippets: ragSnippets.length ? ragSnippets : undefined,
        codeExcerpts: codeExcerpt
          ? [{ file: codeExcerpt.file, text: codeExcerpt.text }]
          : undefined,
        adviceCandidate: advicePlan?.selected,
      });
      if (
        llmBundle.tone === "advice" &&
        !llmBundle.practicalHook &&
        !(llmBundle.adviceSteps && llmBundle.adviceSteps.length)
      ) {
        const retry = await proactive.synthesizeProactiveBundle(settings, {
          bundle,
          tone: "advice",
          bannedTopics: banned,
          candidateTopics,
          sessionMinutes: mergedOpts.sessionMinutes,
          windowMinutes: mergedOpts.windowMinutes,
          companionSilenceMs: mergedOpts.companionSilenceMs,
          recentUserMessage: mergedOpts.recentUserMessage,
          urgency: mergedOpts.urgency,
          recentChatTurns: mergedOpts.recentChatTurns,
          llmOnline: true,
          requirePracticalHook: true,
          codeExcerpts: codeExcerpt
            ? [{ file: codeExcerpt.file, text: codeExcerpt.text }]
            : undefined,
          adviceCandidate: advicePlan?.selected,
        });
        if (retry.practicalHook || retry.adviceSteps?.length) {
          llmBundle = retry;
        }
      }
      if (
        tone === "advice" &&
        llmBundle.shouldSend &&
        proactive.isThinAdviceContext(adviceFacts)
      ) {
        const hookText = llmBundle.practicalHook ?? "";
        if (
          proactive.isThinContextGenericAdvice(hookText, adviceFacts, llmBundle) ||
          proactive.isGenericAdviceText(hookText)
        ) {
          const clarifying = proactive.buildClarifyingProbeBundle(
            {
              bundle,
              tone: "advice",
              bannedTopics: banned,
              candidateTopics,
              sessionMinutes: mergedOpts.sessionMinutes,
              windowMinutes: mergedOpts.windowMinutes,
              companionSilenceMs: mergedOpts.companionSilenceMs,
              recentUserMessage: mergedOpts.recentUserMessage,
              urgency: mergedOpts.urgency,
              recentChatTurns: mergedOpts.recentChatTurns,
              ragSnippets: ragSnippets.length ? ragSnippets : undefined,
              adviceCandidate: advicePlan?.selected,
            },
            adviceFacts,
            "thin context generic synthesis",
          );
          if (clarifying) {
            llmBundle = clarifying;
            proactive.setLastProactiveLlmBundle(clarifying, adviceFacts);
          }
        }
      }
      if (tone === "advice" && llmBundle.shouldSend) {
        const hookText = [
          llmBundle.practicalHook,
          ...(llmBundle.adviceSteps ?? []),
        ]
          .filter(Boolean)
          .join(" ");
        const duplicateIssues = evaluateAdviceNovelty({
          text: hookText,
          candidateKind:
            llmBundle.selectedAdviceCandidate?.kind ?? llmBundle.initiativeMove,
          recentEntries: loadAdviceLedger().filter(
            (entry) => entry.topicKey === adviceTopicKey,
          ),
        });
        const isNearDuplicate = duplicateIssues.some(
          (issue) =>
            issue.kind === "repeat_text" || issue.kind === "repeat_archetype",
        );
        if (isNearDuplicate) {
          const rotated = proactive.buildClarifyingProbeBundle(
            {
              bundle,
              tone: "advice",
              bannedTopics: banned,
              candidateTopics,
              sessionMinutes: mergedOpts.sessionMinutes,
              windowMinutes: mergedOpts.windowMinutes,
              companionSilenceMs: mergedOpts.companionSilenceMs,
              recentUserMessage: mergedOpts.recentUserMessage,
              urgency: mergedOpts.urgency,
              recentChatTurns: mergedOpts.recentChatTurns,
              ragSnippets: ragSnippets.length ? ragSnippets : undefined,
              adviceCandidate: advicePlan?.selected,
            },
            adviceFacts,
            "duplicate advice rotated",
          );
          const rotatedNovelty = rotated
            ? evaluateAdviceNovelty({
                text: rotated.practicalHook ?? "",
                candidateKind: "clarifying_probe",
                recentEntries: loadAdviceLedger().filter(
                  (entry) => entry.topicKey === adviceTopicKey,
                ),
              })
            : [];
          if (
            rotated &&
            !rotatedNovelty.some((issue) => issue.kind === "repeat_text")
          ) {
            llmBundle = rotated;
            proactive.setLastProactiveLlmBundle(rotated, adviceFacts);
          } else {
            recordInitiativeSuppressed("duplicate advice — defer to smalltalk");
            return null;
          }
        }
      }
      if (!llmBundle.shouldSend) {
        if (tone === "advice") {
          const fallbackBundle = proactive.tryAdviceFallbackChain(
            {
              bundle,
              tone,
              bannedTopics: banned,
              candidateTopics,
              sessionMinutes: mergedOpts.sessionMinutes,
              windowMinutes: mergedOpts.windowMinutes,
              companionSilenceMs: mergedOpts.companionSilenceMs,
              recentUserMessage: mergedOpts.recentUserMessage,
              urgency: mergedOpts.urgency,
              recentChatTurns: mergedOpts.recentChatTurns,
              ragSnippets: ragSnippets.length ? ragSnippets : undefined,
              adviceCandidate: advicePlan?.selected,
            },
            adviceFacts,
            llmBundle.rejectReason ?? "llm synthesis rejected",
          );
          if (fallbackBundle) {
            llmBundle = fallbackBundle;
            proactive.setLastProactiveLlmBundle(fallbackBundle, adviceFacts);
          } else {
            recordInitiativeSuppressed(
              llmBundle.rejectReason ?? "llm bundle rejected",
            );
            return null;
          }
        } else {
          recordInitiativeSuppressed(
            llmBundle.rejectReason ?? "llm bundle rejected",
          );
          return null;
        }
      }
      packageOptions = {
        ...packageOptions,
        conversationTopics:
          llmBundle.linkedThemes.length > 0
            ? llmBundle.linkedThemes
            : candidateTopics,
        llmBundle,
        proactiveCodeExcerpt: codeExcerpt
          ? { file: codeExcerpt.file, text: codeExcerpt.text }
          : undefined,
      };
      }
    }

    return buildProactiveInitiativePackage(settings, kind, packageOptions);
  }

  type InitiativeLaunchResult = { sent: boolean; suppressReason?: string };

  async function launchProactiveInitiative(
    pkg: ProactiveInitiativePackage,
    extra: {
      ignoreKindDailyCap?: boolean;
      kindCooldownMs?: number;
      plannedCheckMinSilenceMs?: number;
      engineApproved?: boolean;
    } = {},
  ): Promise<InitiativeLaunchResult> {
    const isAdvice = pkg.proactiveReplyTone === "advice";
    if (isAdvice && !canEmitAdviceNow(settings)) {
      return { sent: false, suppressReason: "cross-channel gap blocks advice" };
    }
    if (!isAdvice && !canEmitSmalltalkNow(settings)) {
      return { sent: false, suppressReason: "cross-channel gap blocks smalltalk" };
    }
    if (pkg.proactiveReplyTone === "advice") {
      refreshAdviceTopicState({
        anchor: pkg.initiativeAnchor,
        processName: activeWindowRef.current?.processName,
        windowTitle: activeWindowRef.current?.title,
        signalSummary: pkg.proactiveSignalSummary,
      });
    }
    const proactive = pkg.llmBundle ? await loadProactiveRuntime() : null;
    const result = await attemptInitiative(pkg.eventDescription, pkg.initiativeKind, {
      initiativeAnchor: pkg.initiativeAnchor,
      softInitiativeAnchor: pkg.softInitiativeAnchor ?? true,
      bannedProactiveTopics: pkg.bannedProactiveTopics,
      plannedCheckFreshTopics: pkg.plannedCheckFreshTopics,
      skipLlmGate: pkg.skipLlmGate,
      proactiveReplyTone: pkg.proactiveReplyTone,
      advisorAngle: pkg.advisorAngle,
      proactiveSignalSummary: pkg.proactiveSignalSummary,
      gateContext: pkg.llmBundle
        ? proactive!.buildGateContextFromBundle(pkg.llmBundle)
        : undefined,
      proactiveLinkNarrative:
        pkg.llmBundle?.primaryChainSummary ??
        pkg.llmBundle?.narrativeBrief,
      proactivePracticalHook: pkg.llmBundle?.practicalHook,
      proactiveAdviceSteps: pkg.llmBundle?.adviceSteps,
      proactiveInitiativeMove: pkg.llmBundle?.initiativeMove,
      proactiveAdviceCandidateKind:
        pkg.llmBundle?.selectedAdviceCandidate?.kind,
      proactiveNoveltyGuidance: describeAdviceNoveltyForPrompt(
        loadAdviceLedger(),
      ),
      engineApproved: extra.engineApproved,
      ignoreKindDailyCap: extra.ignoreKindDailyCap,
      kindCooldownMs: extra.kindCooldownMs,
      plannedCheckMinSilenceMs: extra.plannedCheckMinSilenceMs,
    });
    if (result.sent) {
      if (isAdvice) {
        markAdviceAttemptAt();
      } else {
        markSmalltalkAttemptAt();
      }
    }
    return result;
  }

  async function attemptInitiative(
    eventDescription: string,
    forcedKind?: InitiativeKind,
    options: {
      ignoreKindDailyCap?: boolean;
      initiativeAnchor?: string;
      softInitiativeAnchor?: boolean;
      bannedProactiveTopics?: string[];
      plannedCheckFreshTopics?: boolean;
      kindCooldownMs?: number;
      skipLlmGate?: boolean;
      plannedCheckMinSilenceMs?: number;
      proactiveReplyTone?: ProactiveReplyTone;
      advisorAngle?: AdvisorAngle;
      proactiveSignalSummary?: string;
      gateContext?: string;
      proactiveLinkNarrative?: string;
      proactivePracticalHook?: string;
      proactiveAdviceSteps?: string[];
      proactiveCodeExcerpt?: { file: string; text: string };
      proactiveInitiativeMove?: string;
      proactiveAdviceCandidateKind?: string;
      proactiveNoveltyGuidance?: string;
      engineApproved?: boolean;
    } = {},
  ): Promise<InitiativeLaunchResult> {
    const suppress = (reason: string): InitiativeLaunchResult => {
      recordInitiativeSuppressed(reason);
      return { sent: false, suppressReason: reason };
    };
    const interruptibility = resolveInterruptibilityTier();
    const initiativeKind =
      forcedKind ?? classifyInitiativeKind(eventDescription);
    const backoff = getProactiveFailureBackoff();
    if (backoff) {
      return suppress(
        `proactive backoff ${Math.ceil((backoff.until - Date.now()) / 60_000)}m`,
      );
    }

    const now = Date.now();
    const isAdviceTone = options.proactiveReplyTone === "advice";
    if (isAdviceTone && !canEmitAdviceNow(settings, now)) {
      return suppress("cross-channel gap blocks advice");
    }
    if (options.proactiveReplyTone && !isAdviceTone && !canEmitSmalltalkNow(settings, now)) {
      return suppress("cross-channel gap blocks smalltalk");
    }

    if (!allowsInitiativeForKind(interruptibility, initiativeKind)) {
      ariLog("initiative", "debug", {
        stage: "suppressed",
        description: eventDescription,
        reason: "interruptibility blocks initiative",
        interruptibility: describeInterruptibility(interruptibility),
        initiativeKind,
      });
      return suppress("interruptibility blocks initiative");
    }

    if (
      gateBusyRef.current ||
      isLoadingRef.current ||
      isQuietHours(settings) ||
      isQuietModeActive(settings, activeWindow) ||
      blocksInitiative(lifecycle)
    ) {
      ariLog("initiative", "debug", {
        stage: "suppressed",
        description: eventDescription,
        reason: "busy, offline, quiet mode, or lifecycle gate",
        interruptibility: describeInterruptibility(interruptibility),
      });
      return suppress("busy, offline, quiet mode, or lifecycle gate");
    }

    if (
      !canUseInitiativeKind(initiativeKind, {
        cooldownMs: options.kindCooldownMs,
      })
    ) {
      return suppress(`cooldown for ${initiativeKind}`);
    }
    if (
      !options.ignoreKindDailyCap &&
      isDailyKindCapReached(
        initiativeKind,
        dailyInitiativeKindCap(initiativeKind, settings),
      )
    ) {
      return suppress(`daily cap for ${initiativeKind}`);
    }
    const openLoopHint = topOpenLoopRef.current;
    const userIntent = settings.intentClassifierEnabled
      ? classifyUserIntent(eventDescription).intent
      : undefined;
    const practicalAdviceReady =
      options.engineApproved ||
      (options.proactiveReplyTone === "advice" &&
      Boolean(
        options.proactivePracticalHook ||
          options.proactiveAdviceCandidateKind ||
          options.proactiveLinkNarrative ||
          options.gateContext,
      ));
    const localDecision = scoreInitiativeLocally({
      description: eventDescription,
      scene,
      chatClosedAgoMs: Date.now() - lastChatClosedAtRef.current,
      userActivityAgoMs: Math.max(
        Date.now() - lastUserActivityRef.current,
        userIdleSeconds * 1000,
      ),
      dailyCap: dailyInitiativeCap(settings),
      riskTolerance: initiativeRiskTolerance(settings),
      plannedCheckMinSilenceMs:
        options.plannedCheckMinSilenceMs ??
        proactiveSmalltalkIntervalMs(settings),
      openLoopHint,
      mood,
      intent: userIntent,
      adaptiveEnabled: settings.adaptiveInitiativeEnabled,
      plannedCheckFreshTopics: options.plannedCheckFreshTopics,
      practicalAdviceReady,
      engineApproved: options.engineApproved,
    });
    lastInitiativeFeaturesRef.current = buildInitiativeFeatures({
      risk: localDecision.annoyanceRisk,
      value: localDecision.value,
      scene,
      mood,
      ignoredCount: getRecentIgnoredInitiativeCount(),
      intent: userIntent,
    });
    ariLog("initiative", "debug", {
      stage: localDecision.allowed ? "considered" : "suppressed",
      description: eventDescription,
      reason: localDecision.reason,
      value: localDecision.value,
      annoyanceRisk: localDecision.annoyanceRisk,
      interruptibility: describeInterruptibility(interruptibility),
    });
    if (!localDecision.allowed) {
      return suppress(localDecision.reason);
    }
    gateBusyRef.current = true;
    try {
      if (!isLlmProviderOnline(settings, ollamaOnline)) {
        return suppress("llm offline");
      }
      let topic = eventDescription;
      if (
        shouldUseLlmInitiativeGate(localDecision, {
          skipForPlannedCheckIn:
            options.skipLlmGate ||
            options.proactiveReplyTone === "advice" ||
            (initiativeKind === "check_in" &&
              isPlannedCheckDescription(eventDescription)),
        })
      ) {
        const decision = await shouldSendInitiative(
          historyRef.current,
          options.gateContext ?? eventDescription,
          settings,
        );
        if (!decision.shouldSend) {
          const relevanceReason = `relevance gate: ${decision.topic || "no topic"}`;
          ariLog("initiative", "debug", {
            stage: "suppressed",
            description: eventDescription,
            reason: relevanceReason,
            interruptibility: describeInterruptibility(interruptibility),
          });
          return suppress(relevanceReason);
        }
        topic = decision.topic || eventDescription;
      }

      ariLog("initiative", "debug", {
        stage: "sent",
        description: eventDescription,
        reason: topic,
        interruptibility: describeInterruptibility(interruptibility),
      });
      if (settings.proactiveOpenChat && allowsProactiveChat(interruptibility)) {
        onProactiveMessage();
      }
      const sent = await generateReply(historyRef.current, {
        proactive: true,
        eventDescription: topic,
        initiativeAnchor: options.initiativeAnchor,
        softInitiativeAnchor: options.softInitiativeAnchor,
        bannedProactiveTopics: options.bannedProactiveTopics,
        initiativeKind,
        proactiveReplyTone: options.proactiveReplyTone,
        advisorAngle: options.advisorAngle,
        proactiveSignalSummary: options.proactiveSignalSummary,
        proactiveLinkNarrative: options.proactiveLinkNarrative,
        proactivePracticalHook: options.proactivePracticalHook,
        proactiveAdviceSteps: options.proactiveAdviceSteps,
        proactiveCodeExcerpt: options.proactiveCodeExcerpt,
        proactiveInitiativeMove: options.proactiveInitiativeMove,
        proactiveAdviceCandidateKind: options.proactiveAdviceCandidateKind,
        proactiveNoveltyGuidance: options.proactiveNoveltyGuidance,
      });
      if (sent) {
        setLastProactiveMessageAt();
        markInitiativeKind(initiativeKind);
        markInitiativeSent(
          lastInitiativeFeaturesRef.current ?? undefined,
          settings.adaptiveInitiativeEnabled,
          initiativeKind,
        );
        if (options.proactiveReplyTone) {
          recordProactiveToneEmitted(options.proactiveReplyTone);
          onProactiveMoodEvent?.(
            proactiveToMoodEvent({
              kind: "proactive_sent",
              tone: options.proactiveReplyTone,
              metadata: {
                initiativeKind,
                anchor: options.initiativeAnchor,
                candidateKind: options.proactiveAdviceCandidateKind,
              },
            }),
          );
        }
        if (options.proactiveReplyTone === "advice") {
          const subject = options.initiativeAnchor;
          if (subject) {
            rememberAdviceSubject(subject);
          }
        }
      }
      return { sent };
    } catch (gateError) {
      logError("Initiative gate failed", gateError);
      return suppress("initiative gate error");
    } finally {
      gateBusyRef.current = false;
    }
  }

  useEffect(() => {
    if (
      !settings.remindersEnabled ||
      isQuietModeActive(settings, activeWindow)
    ) {
      return;
    }

    const checkReminders = async () => {
      if (!allowsReminder(resolveInterruptibilityTier())) {
        return;
      }
      if (
        reminderBusyRef.current ||
        gateBusyRef.current ||
        isLoadingRef.current ||
        !isLlmProviderOnline(settings, ollamaOnline) ||
        isQuietHours(settings) ||
        !["observing", "listening"].includes(attention)
      ) {
        return;
      }

      reminderBusyRef.current = true;
      try {
        const dueTasks = getDueTasks();
        const dueLoop = dueTasks[0];
        if (dueLoop?.dueAt) {
          const sent = await runScenarioInitiative("reminder_due", {
            scenario: "reminder_due",
            scene,
            hour: new Date().getHours(),
            idleSeconds: 0,
            chatOpen: isOpen,
            characterState: "idle",
            focusSessionActive: isFocusSessionActive(),
            reminderText: dueLoop.notes ?? dueLoop.title,
            reminderDueAt: dueLoop.dueAt,
          });
          if (sent) {
            markTaskReminded(dueLoop.id);
          } else {
            snoozeTask(dueLoop.id, 30 * 60 * 1000);
          }
          return;
        }
      } catch (reminderError) {
        logError("Intent reminder failed", reminderError);
      } finally {
        reminderBusyRef.current = false;
      }
    };

    void checkReminders();
    const timer = window.setInterval(() => void checkReminders(), 30_000);
    return () => window.clearInterval(timer);
  }, [
    settings.remindersEnabled,
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    ollamaOnline,
    attention,
  ]);

  useEffect(() => {
    if (!settings.proactiveEnabled) {
      return;
    }

    const checkDailyRitual = async () => {
      if (
        ritualBusyRef.current ||
        gateBusyRef.current ||
        isLoadingRef.current ||
        !isLlmProviderOnline(settings, ollamaOnline) ||
        isQuietHours(settings) ||
        !["observing", "listening"].includes(attention)
      ) {
        return;
      }

      const ritual = getPendingDailyRitual();
      if (!ritual) return;
      ritualBusyRef.current = true;
      try {
        const openTasks = loadTasks({ status: "open" }).slice(0, 6);
        const lines = openTasks.map((task) =>
          task.dueAt
            ? `${task.title} — срок ${formatReminderTime(task.dueAt)}`
            : task.title,
        );
        const weekend = [0, 6].includes(new Date().getDay());
        const ritualTone = describeRitualTone(
          ritual,
          getBondLevel(loadRelationship()),
          weekend,
        );
        const sent = await runScenarioInitiative("first_message_today", {
          scenario: "first_message_today",
          scene,
          hour: new Date().getHours(),
          idleSeconds: 0,
          chatOpen: isOpen,
          characterState: "idle",
          ritual,
          ritualTone,
          openLoopLines: lines,
          routineContext: describeRoutineContext(),
        });
        if (sent) {
          markDailyRitualAttempted(ritual);
        }
      } catch (ritualError) {
        logError("Daily ritual failed", ritualError);
      } finally {
        ritualBusyRef.current = false;
      }
    };

    void checkDailyRitual();
    const timer = window.setInterval(() => void checkDailyRitual(), 60_000);
    return () => window.clearInterval(timer);
  }, [
    settings.proactiveEnabled,
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    ollamaOnline,
    attention,
  ]);

  useEffect(() => {
    const companionEventsEnabled =
      settings.proactiveEnabled || settings.eventReactionsEnabled;
    if (!companionEventsEnabled || !activeWindow) {
      observedWindowRef.current = activeWindow
        ? { value: activeWindow, since: Date.now() }
        : null;
      codingSessionRef.current = activeWindow
        ? touchCodingSession(
            codingSessionRef.current,
            activeWindow.processName,
            isCodingProcess(
              activeWindow.processName,
              settings.codingProcessAllowlist,
            ),
          )
        : null;
      return;
    }

    const previous = observedWindowRef.current;
    const changed =
      !previous ||
      previous.value.processName !== activeWindow.processName ||
      previous.value.title !== activeWindow.title;
    if (!changed) {
      return;
    }

    const now = Date.now();
    if (previous) {
      recordActivitySession(
        previous.value.processName,
        now - previous.since,
      );
      if (settings.advisorEnabled) {
        const editorCtx = parseEditorContext(previous.value.title);
        recordFileFocus({
          process: previous.value.processName,
          title: previous.value.title,
          dwellMs: now - previous.since,
          ...editorCtx,
        });
      }
    }
    recordWorkingEvent({
      kind: "window_switch",
      app: activeWindow.processName,
      title: activeWindow.title,
      topic: `Работает в ${activeWindow.processName}: ${activeWindow.title}`,
    });
    appendTimelineEvent({
      kind: "window_switch",
      summary: `${categorizeApp(activeWindow.processName, activeWindow.title)}: ${activeWindow.processName} — ${activeWindow.title}`.slice(
        0,
        200,
      ),
    });
    if (
      settings.advisorEnabled &&
      categorizeApp(activeWindow.processName, activeWindow.title) === "browser"
    ) {
      const searchTopic = parseBrowserSearchTopic(activeWindow.title);
      if (searchTopic) {
        recordQueryTopic({ topic: searchTopic, source: "browser" });
      }
    }
    if (
      previous &&
      isCodingProcess(activeWindow.processName, settings.codingProcessAllowlist) &&
      !isCodingProcess(previous.value.processName, settings.codingProcessAllowlist)
    ) {
      recordWorkingEvent({
        kind: "user_action",
        app: activeWindow.processName,
        title: activeWindow.title,
        topic: `Открыл IDE (${activeWindow.processName})`,
      });
    }
    codingSessionRef.current = touchCodingSession(
      codingSessionRef.current,
      activeWindow.processName,
      isCodingProcess(
        activeWindow.processName,
        settings.codingProcessAllowlist,
      ),
      now,
    );
    observedWindowRef.current = { value: activeWindow, since: now };
    if (
      !previous ||
      now - previous.since < MINIMUM_WINDOW_STAY_MS ||
      now - lastEventReactionRef.current < EVENT_REACTION_COOLDOWN_MS
    ) {
      return;
    }

    const previousMinutes = Math.round((now - previous.since) / 60_000);
    const leftEntertainment = isDistractingProcess(
      previous.value.processName,
      previous.value.title,
      settings.distractorProcessAllowlist,
    );

    lastEventReactionRef.current = now;
    if (leftEntertainment && previousMinutes >= 15) {
      void runScenarioInitiative("return_after_absence", {
        scenario: "return_after_absence",
        scene,
        hour: new Date().getHours(),
        idleSeconds: userIdleSeconds,
        chatOpen: isOpen,
        characterState: "idle",
        absentMinutes: previousMinutes,
        processName: activeWindow.processName,
        windowTitle: activeWindow.title,
        previousProcessName: previous.value.processName,
      });
      return;
    }

    void runPcReactionInitiative("window_switch", "window_switch", {
      scenario: "window_switch",
      scene,
      hour: new Date().getHours(),
      idleSeconds: 0,
      chatOpen: isOpen,
      characterState: "idle",
      processName: activeWindow.processName,
      windowTitle: activeWindow.title,
      previousProcessName: previous.value.processName,
      previousWindowMinutes: Math.round((now - previous.since) / 60_000),
    });
  }, [
    activeWindow,
    settings.proactiveEnabled,
    settings.eventReactionsEnabled,
    settings.advisorEnabled,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
  ]);

  useEffect(() => {
    const previousIdle = lastInputFrictionIdleRef.current;
    lastInputFrictionIdleRef.current = userIdleSeconds;
    if (
      !settings.activityTrackingEnabled ||
      !settings.advisorEnabled ||
      !activeWindow ||
      isQuietModeActive(settings, activeWindow) ||
      !matchesActivityAllowlist(activeWindow, settings.activityAllowlist) ||
      !isCodingProcess(activeWindow.processName, settings.codingProcessAllowlist)
    ) {
      return;
    }

    const observed = observedWindowRef.current;
    const sameWindow =
      observed &&
      observed.value.processName === activeWindow.processName &&
      observed.value.title === activeWindow.title;
    const dwellMs = sameWindow ? Date.now() - observed.since : 0;
    if (dwellMs < 2 * 60_000) {
      return;
    }

    const editorCtx = parseEditorContext(activeWindow.title);
    const base = {
      process: activeWindow.processName,
      title: activeWindow.title,
      file: editorCtx.file,
      dwellMs,
    };

    if (userIdleSeconds >= 45 && userIdleSeconds <= 4 * 60) {
      recordInputFriction({
        ...base,
        frictionKind: "long_pause",
        idleSeconds: userIdleSeconds,
      });
      return;
    }

    if (previousIdle >= 45 && userIdleSeconds < 8) {
      recordInputFriction({
        ...base,
        frictionKind: "rapid_return",
        idleSeconds: previousIdle,
      });
      return;
    }

    if (userIdleSeconds < 5 && dwellMs >= 12 * 60_000) {
      recordInputFriction({
        ...base,
        frictionKind: "active_dwell",
        idleSeconds: userIdleSeconds,
      });
    }
  }, [
    activeWindow,
    settings.activityTrackingEnabled,
    settings.advisorEnabled,
    settings.activityAllowlist,
    settings.codingProcessAllowlist,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    userIdleSeconds,
  ]);

  useEffect(() => {
    if (
      !settings.activityTrackingEnabled ||
      !settings.advisorEnabled ||
      !settings.proactiveEnabled
    ) {
      return;
    }

    let cancelled = false;
    const pollKeyboard = async () => {
      const active = activeWindowRef.current;
      if (
        cancelled ||
        !active ||
        isQuietModeActive(settings, active) ||
        !matchesActivityAllowlist(active, settings.activityAllowlist) ||
        !isCodingProcess(active.processName, settings.codingProcessAllowlist)
      ) {
        return;
      }

      const snapshot = await getKeyboardActivitySnapshot();
      if (cancelled || !snapshot.active) {
        return;
      }

      const observed = observedWindowRef.current;
      const sameWindow =
        observed &&
        observed.value.processName === active.processName &&
        observed.value.title === active.title;
      const dwellMs = sameWindow ? Date.now() - observed.since : 0;
      if (dwellMs < KEYBOARD_ACTIVITY_CONFIG.minWindowDwellMs) {
        return;
      }

      const correctionCount =
        snapshot.backspaceCount + snapshot.deleteCount + snapshot.escapeCount;
      const commandCount = snapshot.undoCount + snapshot.saveCount;
      const keyCount =
        snapshot.printableKeyCount +
        correctionCount +
        snapshot.enterCount +
        snapshot.tabCount +
        snapshot.navigationCount;
      const editorCtx = parseEditorContext(active.title);
      const base = {
        process: active.processName,
        title: active.title,
        file: editorCtx.file,
        dwellMs,
        keyCount,
        correctionCount,
        commandCount,
        burstCount: snapshot.burstCount,
      };

      if (
        correctionCount >= KEYBOARD_ACTIVITY_CONFIG.correctionChurnMin ||
        snapshot.escapeCount >= KEYBOARD_ACTIVITY_CONFIG.escapeChurnMin
      ) {
        recordInputFriction({
          ...base,
          frictionKind: "correction_churn",
        });
        return;
      }

      if (commandCount >= KEYBOARD_ACTIVITY_CONFIG.commandLoopMin) {
        recordInputFriction({
          ...base,
          frictionKind: "command_loop",
        });
        return;
      }

      if (
        snapshot.burstCount > 0 ||
        snapshot.printableKeyCount >= KEYBOARD_ACTIVITY_CONFIG.printableBurstMin
      ) {
        recordInputFriction({
          ...base,
          frictionKind: "keyboard_burst",
        });
      }
    };

    void pollKeyboard();
    const timer = window.setInterval(
      () => void pollKeyboard(),
      KEYBOARD_ACTIVITY_CONFIG.pollIntervalMs,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    settings.activityTrackingEnabled,
    settings.advisorEnabled,
    settings.proactiveEnabled,
    settings.activityAllowlist,
    settings.codingProcessAllowlist,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
  ]);

  useEffect(() => {
    if (!settings.proactiveEnabled && !settings.eventReactionsEnabled) {
      return;
    }

    const checkLongSession = () => {
      const observed = observedWindowRef.current;
      const now = Date.now();
      if (!observed || now - lastEventReactionRef.current < EVENT_REACTION_COOLDOWN_MS) {
        return;
      }
      const sessionMs = now - observed.since;
      const entertainment = isDistractingProcess(
        observed.value.processName,
        observed.value.title,
        settings.distractorProcessAllowlist,
      );
      const thresholdMs = entertainment
        ? LONG_SESSION_ENTERTAINMENT_MS
        : LONG_SESSION_DEFAULT_MS;
      if (sessionMs < thresholdMs) {
        return;
      }

      lastEventReactionRef.current = now;
      observedWindowRef.current = { ...observed, since: now };
      void runPcReactionInitiative("long_focus", "long_session", {
        scenario: "long_session",
        scene,
        hour: new Date().getHours(),
        idleSeconds: 0,
        chatOpen: isOpen,
        characterState: "idle",
        processName: observed.value.processName,
        windowTitle: observed.value.title,
        previousWindowMinutes: Math.round(sessionMs / 60_000),
      });
    };

    const timer = window.setInterval(checkLongSession, 60_000);
    return () => window.clearInterval(timer);
  }, [
    settings.proactiveEnabled,
    settings.eventReactionsEnabled,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    settings.codingProcessAllowlist,
    ollamaOnline,
  ]);

  useEffect(() => {
    if (!settings.proactiveEnabled && !settings.eventReactionsEnabled) {
      return;
    }
    if (!settings.activityTrackingEnabled) {
      return;
    }

    const checkCompanionAmbient = () => {
      if (
        isQuietModeActive(settings, activeWindowRef.current) ||
        blocksInitiative(lifecycleRef.current) ||
        isLoadingRef.current
      ) {
        return;
      }
      const observed = observedWindowRef.current;
      const active = activeWindowRef.current;
      if (!observed || !active) {
        return;
      }
      if (
        observed.value.processName !== active.processName ||
        observed.value.title !== active.title
      ) {
        return;
      }
      const sessionMs = Date.now() - observed.since;
      const companionSilenceMs = getCompanionSilenceMs();
      const entertainment = isDistractingProcess(
        active.processName,
        active.title,
        settings.distractorProcessAllowlist,
      );
      if (
        !entertainment ||
        sessionMs < 20 * 60_000 ||
        companionSilenceMs < 20 * 60_000
      ) {
        return;
      }
      if (Date.now() - lastCompanionAmbientRef.current < COMPANION_AMBIENT_COOLDOWN_MS) {
        return;
      }

      lastCompanionAmbientRef.current = Date.now();
      const context = [
        "Пользователь долго в игре или развлечении без разговора с Ari.",
        `Окно: ${active.processName} — ${active.title}.`,
        "Короткая ненавязчивая реплика в ambient-пузыре, без открытия чата.",
      ].join("\n");

      if (isLlmProviderOnline(settings, ollamaOnline)) {
        void prepareProactivePackage("quiet_presence", {
          ...proactiveBundleOptions(),
          eventHint: context,
        }).then((pkg) => {
          if (!pkg) {
            return;
          }
          void launchProactiveInitiative(pkg);
        });
        return;
      }
      recordInitiativeSuppressed("llm offline");
    };

    const timer = window.setInterval(checkCompanionAmbient, 60_000);
    return () => window.clearInterval(timer);
  }, [
    settings.proactiveEnabled,
    settings.eventReactionsEnabled,
    settings.activityTrackingEnabled,
    settings.distractorProcessAllowlist,
    settings.adaptiveInitiativeEnabled,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    ollamaOnline,
  ]);

  useEffect(() => {
    const clipboardCaptureEnabled =
      settings.clipboardFullCaptureEnabled ||
      settings.clipboardObservationEnabled;
    if (
      !clipboardCaptureEnabled ||
      !settings.activityTrackingEnabled ||
      isQuietModeActive(settings, activeWindow)
    ) {
      return;
    }

    let lastClipboard = "";
    const timer = window.setInterval(() => {
      void readClipboardText().then((text) => {
        if (!text || text === lastClipboard) {
          return;
        }
        lastClipboard = text;
        const redacted = redactSecrets(text);
        const clipKind = classifyClipboardText(text);
        if (settings.clipboardFullCaptureEnabled) {
          recordClipboardSignal({
            clipKind,
            snippet: redacted.slice(0, 280),
          });
        }
        if (
          clipKind === "stacktrace" ||
          /(error|exception|ошибк|failed|traceback|panic)/i.test(text)
        ) {
          recordWorkingEvent({
            kind: "process_note",
            topic: `Скопировано в буфер: ${redacted.slice(0, 120)}`,
          });
        }
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [
    settings.clipboardObservationEnabled,
    settings.clipboardFullCaptureEnabled,
    settings.activityTrackingEnabled,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    activeWindow,
  ]);

  useEffect(() => {
    if (
      pomodoro.phase !== "focus" ||
      !settings.proactiveEnabled ||
      !settings.pomodoroEnabled
    ) {
      distractionWindowRef.current = null;
      return;
    }

    let cancelled = false;

    const checkFocusWindow = async () => {
      let active = activeWindowRef.current;
      const cachedKey = active
        ? `${active.processName}\0${active.title}`
        : "";
      if (!cachedKey || cachedKey !== lastFocusPollWindowRef.current) {
        active = await getActiveWindowContext(settings, {
          bypassPrivacyGate: true,
        }).catch(() => null);
        if (active) {
          lastFocusPollWindowRef.current = `${active.processName}\0${active.title}`;
        }
      }

      if (cancelled) {
        return;
      }

      if (!active || isAriWindow(active)) {
        return;
      }

      if (isCodingProcess(active.processName, settings.codingProcessAllowlist)) {
        wasOnCodingWindowRef.current = true;
        distractionWindowRef.current = null;
        return;
      }

      if (
        !isWindowDistracting(
          active,
          wasOnCodingWindowRef.current,
          settings.codingProcessAllowlist,
          settings.distractorProcessAllowlist,
        )
      ) {
        distractionWindowRef.current = null;
        return;
      }

      const now = Date.now();
      const current = distractionWindowRef.current;
      if (
        !current ||
        current.app !== active.processName ||
        current.title !== active.title
      ) {
        distractionWindowRef.current = {
          app: active.processName,
          title: active.title,
          since: now,
          nudged: false,
        };
        return;
      }

      const durationMs = now - current.since;
      if (durationMs < DISTRACTION_THRESHOLD_MS || current.nudged) {
        return;
      }

      const durationSeconds = Math.round(durationMs / 1000);
      recordInterruption(durationSeconds);
      recordWorkingEvent({
        kind: "distraction",
        app: active.processName,
        title: active.title,
        topic: `Отвлёкся на ${active.processName} во время фокуса`,
      });
      appendTimelineEvent({
        kind: "distraction",
        summary: `Отвлечение: ${active.processName}`.slice(0, 200),
      });

      distractionWindowRef.current = { ...current, nudged: true };

      const session = getActiveFocusSession();
      const wmSummary = summarizeWorkingMemory();
      const distractionCountToday =
        wmSummary.distractionApps.find((item) => item.app === active.processName)
          ?.count ?? 1;
      const distractionPkg = buildDistractionPackage(
        settings,
        {
          app: active.processName,
          title: active.title,
          interruptionCount: session?.interruptions.length,
          distractionCountToday,
        },
        proactiveBundleOptions(),
      );
      if (distractionPkg) {
        void launchProactiveInitiative(distractionPkg);
      }
    };

    void checkFocusWindow();
    const timer = window.setInterval(
      () => void checkFocusWindow(),
      POMODORO_FOCUS_POLL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    pomodoro.phase,
    settings.proactiveEnabled,
    settings.pomodoroEnabled,
    settings.codingProcessAllowlist,
    settings.distractorProcessAllowlist,
  ]);

  return (
    <section
      className={`chat-panel${isOpen ? " open" : ""}`}
      aria-label="Чат с Ari"
      aria-hidden={!isOpen}
    >
      <header className="chat-header">
        <div
          className={`presence-dot${
            ollamaOnline === false
              ? " offline"
              : ollamaOnline === null
                ? " checking"
                : ""
          }`}
          aria-hidden="true"
        />
        <div className="chat-identity">
          <strong>Ari</strong>
          <span>
            {ollamaOnline === false
              ? settings.llmProvider === "gigachat"
                ? "GigaChat недоступен"
                : "Ollama недоступна"
              : ollamaOnline === null
                ? settings.llmProvider === "gigachat"
                  ? "проверяю GigaChat…"
                  : "проверяю Ollama…"
                : buildLiveStatusLine({
                    attention,
                    lifecycle,
                    emotion,
                    loading: isLoading,
                    hasStreamTokens,
                    mood,
                  })}
          </span>
        </div>

        <div className="chat-header-actions">
          {isBlipVoiceEnabled(settings) && voiceSpeaking && (
            <button
              type="button"
              className="header-icon-button blip-stop-btn"
              onClick={stopVoice}
              aria-label="Остановить blip voice"
              title="Стоп голос"
            >
              ⏹
            </button>
          )}
          {settings.pomodoroEnabled && (
            <div className="pomodoro-control" title="Помодоро — Ari тихо поддержит во время фокуса">
              {pomodoro.phase === "idle" ? (
                <button
                  type="button"
                  className="header-icon-button pomodoro-button"
                  onClick={() => setShowFocusPrompt((value) => !value)}
                  aria-label="Запустить фокус-сессию"
                >
                  <span className="pomodoro-label">🍅</span>
                </button>
              ) : (
                <div className="pomodoro-active">
                  <span className="pomodoro-timer">
                    <PomodoroCountdown pomodoro={pomodoro} />
                  </span>
                  <span className="pomodoro-phase">
                    {pomodoro.phase === "focus"
                      ? "фокус"
                      : pomodoro.phase === "break"
                        ? "перерыв"
                        : "пауза"}
                  </span>
                  <button
                    type="button"
                    className={`header-icon-button pomodoro-mini-btn${
                      bodyDoubling ? " active" : ""
                    }`}
                    title="Body-doubling — сидеть рядом"
                    aria-label="Body-doubling"
                    onClick={() => setBodyDoubling((value) => !value)}
                  >
                    ◉
                  </button>
                  {pomodoro.phase === "paused" ? (
                    <button
                      type="button"
                      className="header-icon-button pomodoro-mini-btn"
                      onClick={() => resumePomodoro()}
                      title="Продолжить"
                      aria-label="Продолжить"
                    >
                      ▶
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="header-icon-button pomodoro-mini-btn"
                      onClick={() => {
                        recordWorkingEvent({
                          kind: "user_action",
                          topic: "Поставил помодоро на паузу",
                        });
                        pausePomodoro();
                      }}
                      title="Пауза"
                      aria-label="Пауза"
                    >
                      ⏸
                    </button>
                  )}
                  <button
                    type="button"
                    className="header-icon-button pomodoro-mini-btn"
                    onClick={() => {
                      recordWorkingEvent({
                        kind: "user_action",
                        topic: "Пропустил фазу помодоро",
                      });
                      skipPomodoroPhase();
                    }}
                    title="Следующая фаза"
                    aria-label="Следующая фаза"
                  >
                    ⏭
                  </button>
                  <button
                    type="button"
                    className="header-icon-button pomodoro-mini-btn"
                    onClick={() => stopFocusSessionFlow()}
                    title="Остановить"
                    aria-label="Остановить"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            className="header-icon-button shutdown-button"
            type="button"
            onClick={() => void fullShutdown()}
            aria-label={
              settings.llmProvider === "gigachat"
                ? "Полностью выключить Ari"
                : "Полностью выключить Ari и Ollama"
            }
            title={
              settings.llmProvider === "gigachat"
                ? "Полностью выключить Ari"
                : "Полностью выключить Ari и Ollama"
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 2h2v10h-2V2Zm5.7 3.9 1.4-1.4A9 9 0 1 1 5.9 4.5l1.4 1.4a7 7 0 1 0 9.4 0Z" />
            </svg>
          </button>
          <button
            className={`header-icon-button vision-button${
              visionLoading || visionMenuOpen ? " active" : ""
            }`}
            type="button"
            onClick={() => setVisionMenuOpen((open) => !open)}
            aria-label="Посмотреть на активное окно"
            title="Один раз посмотреть на активное окно"
            disabled={isLoading || visionLoading || ollamaOnline !== true}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5c5.5 0 9.5 5.4 9.5 7s-4 7-9.5 7S2.5 13.6 2.5 12 6.5 5 12 5Zm0 2C8.2 7 5.1 10.2 4.5 12c.6 1.8 3.7 5 7.5 5s6.9-3.2 7.5-5c-.6-1.8-3.7-5-7.5-5Zm0 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z" />
            </svg>
          </button>
          {visionMenuOpen && (
            <div className="vision-mode-menu">
              {(["overview", "error", "text", "explain"] as VisionMode[]).map(
                (mode) => (
                  <button
                    type="button"
                    onClick={() => void lookAtActiveWindow(mode)}
                    key={mode}
                  >
                    {visionModeLabels[mode]}
                  </button>
                ),
              )}
              <button
                type="button"
                onClick={() => void lookAtActiveWindow("overview", true)}
              >
                Выбрать область
              </button>
              <button
                type="button"
                className={compareBaseline ? "armed" : ""}
                onClick={() => void lookAtActiveWindow("compare")}
              >
                {compareBaseline
                  ? "Сделать второй снимок"
                  : "Запомнить для сравнения"}
              </button>
              {compareBaseline && (
                <button
                  type="button"
                  onClick={() => {
                    compareBaseline.imageBase64 = "";
                    setCompareBaseline(null);
                    setVisionMenuOpen(false);
                  }}
                >
                  Отменить сравнение
                </button>
              )}
            </div>
          )}
          <button
            className="header-icon-button"
            type="button"
            onClick={() => void repeatLastReply()}
            aria-label="Повторить последний ответ"
            title="Повторить ответ"
            disabled={!canRepeat}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17.7 6.3A8 8 0 0 0 4.3 10H2l3.5 3.5L9 10H6.3a6 6 0 1 1 .8 5.1l-1.4 1.4a8 8 0 1 0 12-10.2Z" />
            </svg>
          </button>
          <button
            className="header-icon-button"
            type="button"
            onClick={clearHistory}
            aria-label="Очистить историю"
            title="Очистить историю"
            disabled={!canClear}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z" />
            </svg>
          </button>
          <button
            className={`header-icon-button${teachMode ? " active" : ""}`}
            type="button"
            onClick={() => setTeachMode((value) => !value)}
            aria-label="Teach Ari"
            title="Teach Ari — сохранить правило поведения"
            disabled={isLoading}
          >
            ✎
          </button>
          <button
            ref={settingsButtonRef}
            className={`header-icon-button${settingsOpen ? " active" : ""}`}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Настройки"
            title="Настройки"
            disabled={isLoading}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19.1 13a7.7 7.7 0 0 0 .1-1 7.7 7.7 0 0 0-.1-1l2.1-1.7-2-3.4-2.6 1a8 8 0 0 0-1.7-1L14.5 3h-4l-.4 2.8a8 8 0 0 0-1.7 1l-2.6-1-2 3.4L5.9 11a7.7 7.7 0 0 0-.1 1 7.7 7.7 0 0 0 .1 1l-2.1 1.7 2 3.4 2.6-1a8 8 0 0 0 1.7 1l.4 2.8h4l.4-2.8a8 8 0 0 0 1.7-1l2.6 1 2-3.4L19.1 13ZM12.5 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
            </svg>
          </button>
        </div>
      </header>

      {teachMode && !settingsOpen && (
        <div className="teach-mode-banner" role="status">
          Режим Teach: опиши правило поведения Ari — оно сохранится в настройках.
        </div>
      )}

      {settingsOpen ? (
        <Suspense fallback={<div className="settings-loading">Загрузка настроек…</div>}>
          <SettingsPanel
            settings={settings}
            onChange={onSettingsChange}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsSubpanel(null);
              settingsButtonRef.current?.focus();
            }}
            activeWindow={activeWindow}
            openSubpanel={settingsSubpanel}
          />
        </Suspense>
      ) : (
        <>
          {showFocusPrompt && pomodoro.phase === "idle" && (
            <div className="focus-prompt-bar">
              {durationSuggestion && (
                <p className="focus-suggestion">{durationSuggestion.reason}</p>
              )}
              <input
                value={focusGoal}
                onChange={(event) => setFocusGoal(event.currentTarget.value)}
                placeholder="Цель этой сессии?"
              />
              <input
                value={focusSuccess}
                onChange={(event) => setFocusSuccess(event.currentTarget.value)}
                placeholder="Что считаем успехом?"
              />
              <input
                value={focusAvoid}
                onChange={(event) => setFocusAvoid(event.currentTarget.value)}
                placeholder="Что нельзя делать во время фокуса?"
              />
              <label className="focus-body-double">
                <input
                  type="checkbox"
                  checked={bodyDoubling}
                  onChange={(event) =>
                    setBodyDoubling(event.currentTarget.checked)
                  }
                />
                Фокус с Ari
              </label>
              <div className="focus-prompt-actions">
                <button type="button" onClick={() => setShowFocusPrompt(false)}>
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={!focusGoal.trim()}
                  onClick={() => startFocusWithGoal()}
                >
                  Старт
                </button>
              </div>
            </div>
          )}
          {pendingCrop && (
            <Suspense fallback={<div className="screen-vision-indicator" role="status">Загрузка…</div>}>
              <VisionCropper
                capture={pendingCrop}
                onConfirm={(selection) => void analyzeCrop(selection)}
                onCancel={() => {
                  pendingCrop.imageBase64 = "";
                  setPendingCrop(null);
                }}
              />
            </Suspense>
          )}
          {visionLoading && (
            <div className="screen-vision-indicator" role="status">
              <span />
              Анализирую один снимок окна…
            </div>
          )}
          {compareBaseline && !visionLoading && (
            <div className="screen-vision-indicator comparison" role="status">
              <span />
              Первый снимок временно сохранён. Нажми глаз → «Сделать второй
              снимок».
            </div>
          )}
          <div className="messages" ref={messagesRef} aria-live="polite">
            {history.length === 0 && (
              <div className="message assistant">{STARTING_LINE}</div>
            )}

            {history.map((message, index) => (
              <div className="message-group" key={`${message.role}-${index}`}>
                <div
                  className={`message-row${
                    message.role === "assistant" ? " assistant-row" : ""
                  }`}
                >
                  <div
                    className={`message ${message.role}${
                      isLoading &&
                      index === history.length - 1 &&
                      message.role === "assistant"
                        ? " streaming"
                        : ""
                    }`}
                  >
                    {(streamingAssistantIndex === index &&
                    streamingContent !== null &&
                    streamingContent !== ""
                      ? streamingContent
                      : message.content) ||
                      (isLoading && message.role === "assistant" ? (
                        <span className="typing-dots" aria-label="Ari думает">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : null)}
                    {message.reaction && (
                      <span
                        className="message-reaction-badge"
                        title="Ваша реакция"
                      >
                        {message.reaction}
                      </span>
                    )}
                  </div>
                  {message.role === "assistant" &&
                    message.content &&
                    !message.focusRecap && (
                      <div className="message-actions-wrap">
                        {isBlipVoiceEnabled(settings) && (
                          <button
                            type="button"
                            className="read-aloud-btn"
                            aria-label="Проиграть blip voice"
                            title={
                              isTooLongForAutoBlip(message.content, settings)
                                ? "Длинный ответ — короткий murmur"
                                : "Blip voice"
                            }
                            disabled={isLoading && index === history.length - 1}
                            onClick={() =>
                              void speakMessage(
                                message.content,
                                message.emotion,
                              )
                            }
                          >
                            🔊
                          </button>
                        )}
                        <button
                          type="button"
                          className={`message-reaction-button${
                            openReactionMenuIndex === index ? " active" : ""
                          }`}
                          aria-label="Реакция на сообщение"
                          aria-expanded={openReactionMenuIndex === index}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenBranchMenuIndex(null);
                            setOpenReactionMenuIndex((current) =>
                              current === index ? null : index,
                            );
                          }}
                        >
                          +
                        </button>
                        {openReactionMenuIndex === index && (
                          <div
                            className="message-reaction-palette"
                            role="menu"
                            aria-label="Выберите реакцию"
                          >
                            {MESSAGE_REACTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                role="menuitem"
                                className={`message-reaction-option${
                                  message.reaction === emoji ? " selected" : ""
                                }`}
                                aria-label={`Реакция ${emoji}`}
                                onClick={() =>
                                  setMessageReaction(index, emoji)
                                }
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          className={`message-menu-button${
                            openBranchMenuIndex === index ? " active" : ""
                          }`}
                          aria-label="Действия с ответом"
                          aria-expanded={openBranchMenuIndex === index}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenReactionMenuIndex(null);
                            setOpenBranchMenuIndex((current) =>
                              current === index ? null : index,
                            );
                          }}
                        >
                          ⋯
                        </button>
                        {openBranchMenuIndex === index && (
                          <div className="message-actions-menu" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              disabled={isLoading}
                              onClick={() => {
                                setOpenBranchMenuIndex(null);
                                void generateReply(history.slice(0, index));
                              }}
                            >
                              Перегенерировать
                            </button>
                            {message.adviceId && (
                              <>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() =>
                                    markAdviceFeedback(
                                      index,
                                      message.adviceId!,
                                      "useful",
                                    )
                                  }
                                >
                                  Совет полезен
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() =>
                                    markAdviceFeedback(
                                      index,
                                      message.adviceId!,
                                      "not_now",
                                    )
                                  }
                                >
                                  Не сейчас
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() =>
                                    markAdviceFeedback(
                                      index,
                                      message.adviceId!,
                                      "miss",
                                    )
                                  }
                                >
                                  Мимо контекста
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() =>
                                    markAdviceFeedback(
                                      index,
                                      message.adviceId!,
                                      "too_generic",
                                    )
                                  }
                                >
                                  Слишком общо
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                </div>
                {message.focusRecap && (
                  <div className="focus-recap-actions">
                    <button
                      type="button"
                      onClick={() =>
                        void createThreadFromRecap(message.focusRecap!)
                      }
                    >
                      Создать нить
                    </button>
                  </div>
                )}
                {message.action && (
                  <div
                    className={`safe-action-card ${message.action.status}`}
                  >
                    <div>
                      <strong>{message.action.title}</strong>
                      <span>{describeSafeActionDetail(message.action)}</span>
                    </div>
                    {message.action.status === "pending" ? (
                      <div className="safe-action-buttons">
                        <button
                          type="button"
                          onClick={() => void approveAction(message.action!)}
                        >
                          Разрешить
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectAction(message.action!)}
                        >
                          Отклонить
                        </button>
                      </div>
                    ) : (
                      <small>{message.action.result}</small>
                    )}
                  </div>
                )}
              </div>
            ))}

            {liveToolStatus && (
              <div className="chat-tool-status" aria-live="polite">
                {liveToolStatus}
              </div>
            )}

            {error && (
              <div className="chat-error" role="alert">
                <p>{error}</p>
                <div className="chat-error-actions">
                  {lastRetryMessageRef.current && (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        if (isLoading) return;
                        setError(null);
                        void generateReply(historyRef.current);
                      }}
                    >
                      Повторить
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      window.dispatchEvent(new Event("ari-open-settings"))
                    }
                  >
                    Настройки
                  </button>
                </div>
              </div>
            )}
          </div>

          <form className="chat-input-row" onSubmit={sendMessage}>
            <div className="quick-command-wrap" ref={quickCommandRef}>
              <button
                type="button"
                className={`quick-command-trigger${quickCommandOpen ? " active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={quickCommandOpen}
                aria-label="Открыть список команд"
                title="Команды"
                disabled={isLoading || visionLoading || ollamaOnline !== true}
                onClick={() => setQuickCommandOpen((open) => !open)}
              >
                <span aria-hidden="true">⌘</span>
              </button>
              {quickCommandOpen && (
                <div className="quick-command-menu" role="menu">
                  {QUICK_COMMAND_GROUPS.map((group) => (
                    <div className="quick-command-group" key={group.title}>
                      <div className="quick-command-heading">{group.title}</div>
                      {group.commands.map((command) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={`${group.title}-${command.label}`}
                          className="quick-command-item"
                          onClick={() => insertQuickCommand(command.value)}
                          title={command.hint ?? command.value}
                        >
                          <span>{command.label}</span>
                          <small>{command.value}</small>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <input
              ref={inputRef}
              value={input}
              onFocus={() => setChatInputFocused(true)}
              onBlur={() => setChatInputFocused(false)}
              onChange={(event) => {
                recordChatTyping();
                lastUserActivityRef.current = Date.now();
                setInput(event.currentTarget.value);
                const now = Date.now();
                if (now - lastTypingDispatchRef.current >= 1500) {
                  lastTypingDispatchRef.current = now;
                  window.dispatchEvent(new CustomEvent(ARI_USER_TYPING_EVENT));
                }
              }}
              placeholder={
                isLoading
                  ? "Ari отвечает…"
                  : teachMode
                    ? "Опиши правило для Ari…"
                    : "Написать Ari…"
              }
              aria-label="Сообщение для Ari"
              autoComplete="off"
              disabled={isLoading || visionLoading || ollamaOnline !== true}
            />
            {isLoading ? (
              <button
                className="stop-button"
                type="button"
                onClick={stopGeneration}
                aria-label="Остановить генерацию"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim().length === 0}
                aria-label="Отправить сообщение"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3.4 20.1 21 12 3.4 3.9 3 10.2l12 1.8-12 1.8.4 6.3Z" />
                </svg>
              </button>
            )}
          </form>
        </>
      )}
    </section>
  );
}
