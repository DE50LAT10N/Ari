import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
  buildMoodRefusalReply,
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
  ensureProactiveClockStarted,
  armProactiveGracePeriod,
  getLastProactiveAttemptAt,
  registerProactiveReplySubject,
  setLastProactiveAttemptAt,
  setLastProactiveMessageAt,
  rememberAdviceSubject,
} from "../character/proactiveState";
import {
  isAdviceReady,
  planSignalDrivenAdvice,
  getLastAdviceUrgency,
  scoreAdviceUrgency,
  setLastAdviceUrgency,
} from "../character/adviceUrgency";
import {
  buildInitiativeSignalBundle,
  buildProactiveInitiativePackage,
  collectBannedProactiveTopics,
  loadPersistedVisionObservation,
  type ProactiveInitiativePackage,
  type ProactivePackageOptions,
} from "../character/initiativeContext";
import {
  afterAdviceAttempt,
  evaluateProactiveTick,
} from "../character/checkInitiativePolicy";
import {
  drainProactiveRequests,
  subscribeProactiveRequests,
} from "../character/proactiveBridge";
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
  analyzeScreenCapture,
  compareScreenCaptures,
} from "../llm/visionClient";
import {
  visionModeLabels,
  visionModePrompt,
  AUTO_VISION_GLANCE_PROMPT,
  type VisionMode,
} from "../llm/visionModes";
import { extractEpisodeAndLoops } from "../memory/episodeExtractor";
import {
  addEpisodes,
  addOpenLoops,
  loadOpenLoops,
  resolveOpenLoops,
  selectEpisodicContext,
} from "../memory/episodicMemory";
import { extractUserFacts } from "../memory/memoryExtractor";
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
import {
  captureActiveWindow,
  cropScreenCapture,
  type ScreenCapture,
} from "../platform/screenCapture";
import { getRagSearchMode, searchRag } from "../rag/ragClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type {
  CharacterEmotion,
  CharacterState,
} from "../types/character";
import { SettingsPanel } from "./SettingsPanel";
import { ARI_USER_TYPING_EVENT } from "./avatarMotion";
import { VisionCropper } from "./VisionCropper";
import {
  classifyResponseMode,
} from "../character/responseModes";
import {
  describeAriSelfMemory,
  loadAriSelfMemory,
  updateAriSelfMemory,
} from "../character/selfMemory";
import { chooseIdleLine } from "../character/idleLines";
import {
  canUseInitiativeKind,
  classifyInitiativeKind,
  markInitiativeKind,
  type InitiativeKind,
} from "../character/initiativeKinds";
import {
  markInitiativeAcknowledged,
  markInitiativeSent,
  pruneExpiredPendingInitiatives,
  scoreInitiativeLocally,
  getRecentIgnoredInitiativeCount,
  shouldUseLlmInitiativeGate,
  isPlannedCheckDescription,
  buildInitiativeFeatures,
  recordInitiativeOutcome,
  isDailyKindCapReached,
  type InitiativeFeatureVector,
  type LocalInitiativeDecision,
} from "../character/initiativeScoring";
import { classifyUserIntent } from "../character/userIntent";
import { applyRetrievalRerank } from "../memory/retrievalRerank";
import type { RetrievalSearchMode } from "../memory/retrievalTelemetry";
import { getMemorySemanticSearchMode } from "../memory/memorySemanticIndex";
import {
  deriveInterruptibility,
  allowsInitiativeForKind,
  canEmitProactiveReply,
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
  getNextTask,
  getHighPriorityOpenTasks,
  markTaskReminded,
  snoozeTask,
  loadTasks,
} from "../tasks/taskStore";
import { formatGoalLedgerForPrompt } from "../tasks/goalLedger";
import { tryHandleChatCommand } from "../chat/chatCommands";
import { ensureGoalForFocus } from "../tasks/goalLedger";
import { describePinnedProjectContext } from "../character/projectBinder";
import { buildMemoryCallbackPackage, buildDistractionPackage } from "../memory/memoryProactive";
import {
  recordClipboardSignal,
  recordFileFocus,
  recordQueryTopic,
} from "../memory/activitySignals";
import type { AdvisorAngle } from "../character/advisorEngine";
import {
  buildConversationTopics,
  pickPlannedInitiativeAnchor,
} from "../character/advisorEngine";
import {
  buildGateContextFromBundle,
  collectProactiveSignalFacts,
  getLastProactiveLlmBundle,
  getLastProactiveSignalFacts,
  synthesizeProactiveBundle,
  validateProactiveReplyLlm,
} from "../character/proactiveLinkSynthesizer";
import {
  buildAdviceTopicKey,
  getRecentAdviceFeedback,
  refreshAdviceTopicState,
  rememberAdviceSent,
  updateAdviceFeedback,
  type AdviceFeedback,
} from "../character/adviceLedger";
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
  isProactiveWorkContext,
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
import { appendTimelineEvent } from "../memory/activityTimeline";
import { isLlmProviderOnline, isVisionProviderOnline } from "../llm/providerOnline";
import { readClipboardText, classifyClipboardText } from "../platform/clipboard";
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
  VOICE_CHANGED_EVENT,
} from "../character/blipVoiceManager";
import { isBlipVoiceEnabled } from "../settings/appSettings";
import {
  executeSafeAction,
  describeSafeActionDetail,
  extractSafeAction,
  logFailedAction,
  logRejectedAction,
  type SafeActionProposal,
} from "../tools/safeActions";
import {
  formatLiveToolContext,
  isQuestionLikeMessage,
  planLiveToolUse,
  type LiveToolPlan,
  needsExplicitLiveToolPlanner,
  runLiveTool,
  shouldAutoWebSearch,
} from "../tools/liveTools";
import { yieldToMain, withTimeout } from "../platform/asyncTimeout";
import { rememberReplyPhrases } from "../character/phraseMemory";
import { isQuietModeActive } from "../character/quietMode";
import {
  biasEmotionByMood,
} from "../character/emotionPresentation";
import {
  buildCorrectionUserMessage,
  buildInCharacterFallback,
  processModelReply,
  shouldRetryReply,
  shouldUseInCharacterFallback,
} from "../character/replyPipeline";
import {
  allowsGenericCompanionInitiative,
  dailyInitiativeCap,
  dailyInitiativeKindCap,
  initiativeRiskTolerance,
  proactiveIntervalMs,
  shouldUseIdleLineFallback,
} from "../character/initiativeConfig";
import { describeEmotionAntiRepeat } from "../character/emotionHistory";
import { recordInitiativeSuppressed } from "../memory/memoryTelemetry";
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
type ChatPanelProps = {
  isOpen: boolean;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onEmotionChange: (
    emotion: CharacterEmotion,
    reason?: "model" | "initiative",
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
      | "ignored_initiative"
      | "long_silence",
  ) => void;
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
const COMPANION_SESSION_MIN_MS = 15 * 60 * 1000;
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
  const [proactiveNotice, setProactiveNotice] = useState<string | null>(null);
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
  const lastProactiveIntervalRef = useRef(settings.proactiveIntervalMinutes);
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
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [openBranchMenuIndex, setOpenBranchMenuIndex] = useState<number | null>(
    null,
  );
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
    if (openBranchMenuIndex === null) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".message-actions-wrap")
      ) {
        return;
      }
      setOpenBranchMenuIndex(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openBranchMenuIndex]);

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
    const update = () => setVoiceSpeaking(blipVoiceManager.isSpeaking());
    window.addEventListener(VOICE_CHANGED_EVENT, update);
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, update);
  }, []);

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

  function stopGeneration() {
    abortControllerRef.current?.abort();
    blipVoiceManager.stop();
    onStateChange(isOpen ? "listening" : "idle");
  }

  function stopVoice() {
    blipVoiceManager.stop();
    onStateChange(isOpen ? "listening" : "idle");
  }

  async function speakMessage(
    content: string,
    messageEmotion?: CharacterEmotion,
  ) {
    const emotion = messageEmotion ?? "neutral";
    onEmotionChange(emotion, "model");
    await blipVoiceManager.speak(content, {
      settings,
      emotion,
      force: true,
      activeWindow,
      onSpeakingStart: () => onStateChange("speaking"),
      onSpeakingEnd: () => onStateChange(isOpen ? "listening" : "idle"),
    });
  }

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
        const observations = await compareScreenCaptures(
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

    setHistory([
      {
        role: "assistant",
        content: "Историю протёрла. Подозрительно чисто.",
        emotion: "amused",
      },
    ]);
    setError(null);
    onEmotionChange("amused");
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
      proactiveInitiativeMove?: string;
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

    function applyReplyEmotion(
      nextEmotion: CharacterEmotion,
      force = false,
    ) {
      if (!force && nextEmotion === "neutral") {
        return;
      }
      onEmotionChange(
        nextEmotion,
        options.proactive ? "initiative" : "model",
      );
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

    const blipOptions = {
      settings,
      initiative: options.proactive,
      reply: !options.proactive,
      technical: false as boolean,
      activeWindow,
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
        if (!isOpen && options.proactive && displayText.trim()) {
          onAmbientBubble?.(displayText.slice(0, 220));
        }
      },
      onSpeakingStart: () => {
        onStateChange("speaking");
      },
      onSpeakingEnd: () => {
        onStateChange(isOpen ? "listening" : "idle");
        if (!isOpen && options.proactive) {
          window.setTimeout(() => onAmbientBubble?.(null), 5000);
        }
      },
    };

    try {
      const lastUserMessage = [...baseHistory]
        .reverse()
        .find(({ role }) => role === "user")?.content ?? "";
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
      let rawMemory: Awaited<ReturnType<typeof searchRag>> = [];
      let rawUserMemory: Awaited<
        ReturnType<typeof selectUserMemoryContext>
      > = { facts: [], summaries: [] as UserMemorySummary[] };
      let episodicMemory: Awaited<
        ReturnType<typeof selectEpisodicContext>
      > = { episodes: [], openLoops: [] };
      if (
        (settings.ragEnabled || settings.userMemoryEnabled) &&
        memoryQuery.trim() &&
        !options.proactive
      ) {
        setLiveToolStatus(
          settings.ragEnabled ? "ищу в документах…" : "читаю память…",
        );
        await yieldToMain();
      }
      type ContextBundle = [
        PromiseSettledResult<Awaited<ReturnType<typeof searchRag>>>,
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
      try {
        contextResults = await withTimeout(
          Promise.allSettled([
            searchRag(memoryQuery, settings),
            settings.userMemoryEnabled
              ? selectUserMemoryContext(memoryQuery, 18, 6, settings)
              : Promise.resolve({
                  facts: [],
                  summaries: [] as UserMemorySummary[],
                }),
            settings.userMemoryEnabled
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
      const ragMode = getRagSearchMode();
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
      const needsExplicitTool = needsExplicitLiveToolPlanner(lastUserMessage);
      const needsWebFallback = shouldAutoWebSearch(lastUserMessage, {
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
            )
          ) {
            const query = buildProactiveWebSearchQuery(
              proactiveBundle,
              options.initiativeAnchor,
            );
            setLiveToolStatus("ищу в интернете…");
            const raw = await withTimeout(
              runLiveTool({ tool: "web_search", query }, settings),
              30_000,
              "Проактивный поиск",
            );
            liveToolContext = formatLiveToolContext(
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
        settings.webToolsEnabled &&
        !options.proactive &&
        isLlmProviderOnline(settings, ollamaOnline) &&
        lastUserMessage.trim() &&
        (needsExplicitTool || (!ragFound && needsWebFallback))
      ) {
        try {
          let plan: LiveToolPlan | null = null;
          if (needsExplicitTool) {
            plan = await planLiveToolUse(lastUserMessage, settings);
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
            const raw = await runLiveTool(plan, settings);
            liveToolContext = formatLiveToolContext(plan, raw);
          }
        } catch (toolError) {
          logError("Live tool failed", toolError);
        } finally {
          setLiveToolStatus(null);
        }
      }

      const responseLength = chooseResponseLength(
        lastUserMessage,
        memory.length,
        Boolean(options.proactive),
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
      const relationshipToneKey = deriveRelationshipTone(relationship, mood);
      const relationshipTone = describeRelationshipTone(relationshipToneKey);
      const recentPhrases = buildAvoidPhrases();
      const recentAssistantReplies = baseHistory
        .filter((message) => message.role === "assistant")
        .map((message) => message.content)
        .slice(-5);
      const workSession = describeActiveFocusSession(getActiveFocusSession());
      const userAskedQuestion = isQuestionLikeMessage(lastUserMessage);
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
        hasDebugSignals:
          Boolean(options.proactive) &&
          proactiveReplyTone === "advice" &&
          hasProactiveDebugSignals(
            buildInitiativeSignalBundle(settings, {
              processName: activeWindow?.processName,
              windowTitle: activeWindow?.title,
            }),
          ),
      };
      const processReplyOptions = {
        responseMode,
        validationContext,
        streamedEmotion: replyEmotion,
        recentAssistantReplies,
        proactive: Boolean(options.proactive),
        userAskedQuestion,
      };
      const emotionGuidance = describeEmotionAntiRepeat(mood);
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
        mood: describeMoodForPrompt(mood),
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
        selfMemory: describeAriSelfMemory(selfMemory),
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
        liveToolContext,
        projectPinnedContext: describePinnedProjectContext() || undefined,
        goalLedger: formatGoalLedgerForPrompt() || undefined,
        proactiveSignalSummary: options.proactiveSignalSummary,
        proactiveLinkNarrative: options.proactiveLinkNarrative,
        proactivePracticalHook: options.proactivePracticalHook,
        proactiveInitiativeMove: options.proactiveInitiativeMove,
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
      blipStreamActive = blipVoiceManager.beginStream(blipOptions);
      if (!blipStreamActive) {
        setStreamingAssistantIndex(assistantIndex);
        setStreamingContent("");
      } else {
        setStreamingAssistantIndex(null);
        setStreamingContent(null);
      }

      async function runStream(
        messages: ReturnType<typeof buildMessages>,
      ): Promise<string> {
        return withTimeout(
          streamLlm(
            messages,
            settings,
            (streamedContent) => {
              streamedContentRef.current = streamedContent;
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
                (value) => setStreamingContent(value),
              );
            },
            (emotion) => {
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

      if (options.proactive && isLlmProviderOnline(settings, ollamaOnline)) {
        const proactiveBundle = getLastProactiveLlmBundle();
        if (proactiveBundle && processed.content.trim()) {
          const quality = await validateProactiveReplyLlm(
            settings,
            proactiveBundle,
            processed.content,
            getLastProactiveSignalFacts(),
          );
          if (!quality.acceptable) {
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
          reply = await runStream(
            buildMessages(correctionHistory, runtimeContext),
          );
          const retryProcessed = processModelReply(reply, processReplyOptions);
          processed =
            retryProcessed.content.trim() || !firstProcessed.content.trim()
              ? retryProcessed
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
        shouldRetryReply(processed.validation) &&
        shouldUseInCharacterFallback(processed.validation)
      ) {
        processed = buildInCharacterFallback();
      }

      if (streamUiTimerRef.current) {
        window.clearTimeout(streamUiTimerRef.current);
        streamUiTimerRef.current = null;
      }
      setStreamingContent(null);
      setStreamingAssistantIndex(null);
      finalReply = processed.content;
      replyEmotion = biasEmotionByMood(processed.emotion, mood);
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
              replyText: finalReply,
              processName: activeWindow?.processName,
              windowTitle: activeWindow?.title,
            })
          : null;
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
        void extractSafeAction(lastUserMessage, finalReply, settings)
          .then((action) => {
            if (!action) return;
            ariLog("reply-meta", "debug", {
              lastActionProposal: action.title,
            });
            setHistory((current) =>
              current.map((message, index) =>
                index === assistantIndex &&
                message.role === "assistant" &&
                message.content === finalReply
                  ? { ...message, action }
                  : message,
              ),
            );
          })
          .catch((actionError: unknown) => {
            logError("Safe action extraction failed", actionError);
          });
      }

      if (
        !options.proactive &&
        !options.screenObservation &&
        lastUserMessage
      ) {
        onMoodInteraction?.("chat_positive");
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
          updateAriSelfMemory(
            current,
            lastUserMessage,
            finalReply,
            replyEmotion,
          ),
        );
      }

      if (
        settings.userMemoryEnabled &&
        !options.proactive &&
        !options.screenObservation &&
        lastUserMessage
      ) {
        void extractUserFacts(lastUserMessage, finalReply, settings)
          .then(async (facts) => {
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
          })
          .catch((memoryError: unknown) => {
            logError("User memory extraction failed", memoryError);
          });

        void loadOpenLoops()
          .then((loops) =>
            extractEpisodeAndLoops(
              lastUserMessage,
              finalReply,
              loops,
              settings,
            ),
          )
          .then(async ({ episode, openLoops, resolvedLoopIds }) => {
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
          .catch((episodeError: unknown) => {
            logError("Episodic memory extraction failed", episodeError);
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
          setProactiveNotice("Инициатива не сработала — модель не ответила.");
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
      }
    }
    return !failed;
  }

  function chooseResponseLength(
    message: string,
    memoryMatches: number,
    proactive: boolean,
  ): "short" | "medium" | "long" {
    if (proactive) {
      return "short";
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
    return "short";
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
      return launchProactiveInitiative(pkg);
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
      const sent = await launchProactiveInitiative(pkg);
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
        const sent = await launchProactiveInitiative(pkg);
        if (sent) {
          markScenarioTriggered(scenario);
          return true;
        }
      }
      const sent = await emitLocalCompanionLine({
        scoreContext: outcome.line,
        skipScore: true,
        localDecision: {
          allowed: true,
          reason: "scenario-local",
          annoyanceRisk: "low",
          value: "medium",
        },
        line: { text: outcome.line, emotion: outcome.emotion },
      });
      if (sent) {
        markScenarioTriggered(scenario);
      }
      return sent;
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
    if (
      settings.adaptiveInitiativeEnabled &&
      lastInitiativeFeaturesRef.current &&
      getRecentIgnoredInitiativeCount() > 0
    ) {
      recordInitiativeOutcome(lastInitiativeFeaturesRef.current, true);
    }
    markInitiativeAcknowledged();
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
    try {
      const result = await executeSafeAction(action, settings, {
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
      logFailedAction(action, result);
      updateAction(action.id, { status: "failed", result });
    }
  }

  function rejectAction(action: SafeActionProposal) {
    logRejectedAction(action);
    updateAction(action.id, {
      status: "rejected",
      result: "Действие отменено.",
    });
  }

  function markAdviceFeedback(
    messageIndex: number,
    adviceId: string,
    feedback: AdviceFeedback,
  ) {
    updateAdviceFeedback(adviceId, feedback);
    setHistory((current) =>
      current.map((message, index) =>
        index === messageIndex
          ? { ...message, adviceFeedback: feedback }
          : message,
      ),
    );
    setOpenBranchMenuIndex(null);
  }

  async function emitLocalCompanionLine(options: {
    scoreContext: string;
    skipScore?: boolean;
    localDecision?: LocalInitiativeDecision;
    plannedCheckMinSilenceMs?: number;
    plannedCheckFreshTopics?: boolean;
    riskToleranceBonus?: number;
    initiativeKind?: InitiativeKind;
    plannedAnchor?: string;
    line?: { text: string; emotion: CharacterEmotion };
    ambientTimeoutMs?: number;
    kindCooldownMs?: number;
  }): Promise<boolean> {
    const initiativeKind = options.initiativeKind ?? "check_in";
    const kindCooldownMs = options.kindCooldownMs;
    const interruptibility = resolveInterruptibilityTier();
    if (!canEmitProactiveReply(interruptibility, initiativeKind)) {
      recordInitiativeSuppressed("interruptibility blocks local companion line");
      return false;
    }
    if (
      isQuietModeActive(settings, activeWindowRef.current) ||
      blocksInitiative(lifecycleRef.current) ||
      !canUseInitiativeKind(initiativeKind, { cooldownMs: kindCooldownMs })
    ) {
      return false;
    }

    let localDecision = options.localDecision;
    if (!options.skipScore) {
      localDecision = scoreInitiativeLocally({
        description: options.scoreContext,
        scene: sceneRef.current,
        chatClosedAgoMs: Date.now() - lastChatClosedAtRef.current,
        userActivityAgoMs: options.plannedCheckMinSilenceMs
          ? Date.now() - lastUserActivityRef.current
          : getCompanionSilenceMs(),
        dailyCap: dailyInitiativeCap(settings),
        riskTolerance:
          initiativeRiskTolerance(settings) + (options.riskToleranceBonus ?? 0),
        plannedCheckMinSilenceMs: options.plannedCheckMinSilenceMs,
        mood: moodRef.current,
        adaptiveEnabled: settings.adaptiveInitiativeEnabled,
        plannedCheckFreshTopics: options.plannedCheckFreshTopics,
      });
    }
    if (!localDecision?.allowed) {
      return false;
    }

    const localLine =
      options.line ?? chooseIdleLine(sceneRef.current, moodRef.current);
    lastInitiativeFeaturesRef.current = buildInitiativeFeatures({
      risk: localDecision.annoyanceRisk,
      value: localDecision.value,
      scene: sceneRef.current,
      mood: moodRef.current,
      ignoredCount: getRecentIgnoredInitiativeCount(),
    });
    markInitiativeKind(initiativeKind);
    markInitiativeSent(
      lastInitiativeFeaturesRef.current,
      settings.adaptiveInitiativeEnabled,
      initiativeKind,
    );
    setLastProactiveMessageAt();
    registerProactiveReplySubject(
      options.plannedAnchor,
      localLine.text,
    );
    const bubbleMs = options.ambientTimeoutMs ?? 10_000;
    const proactiveMessage: ChatMessage = {
      role: "assistant",
      content: localLine.text,
      emotion: localLine.emotion,
      messageId: crypto.randomUUID(),
      isCanon: true,
    };
    setHistory((current) => [...current, proactiveMessage]);

    if (!isOpen) {
      onAmbientBubble?.(localLine.text);
      onEmotionChange(localLine.emotion, "initiative");
      onProactiveEmitted?.(localLine.emotion);
      if (settings.proactiveOpenChat) {
        onProactiveMessage();
      }
      if (
        settings.blipSpeakInitiative &&
        isBlipVoiceEnabled(settings) &&
        !isTooLongForAutoBlip(localLine.text, settings)
      ) {
        void blipVoiceManager.speak(localLine.text, {
          settings,
          emotion: localLine.emotion,
          initiative: true,
          activeWindow,
          onSpeakingStart: () => onStateChange("speaking"),
          onSpeakingEnd: () => onStateChange(isOpen ? "listening" : "idle"),
        });
      }
      window.setTimeout(() => onAmbientBubble?.(null), bubbleMs);
      return true;
    }
    if (settings.proactiveOpenChat) {
      onProactiveMessage();
    }
    onEmotionChange(localLine.emotion, "initiative");
    onProactiveEmitted?.(localLine.emotion);
    return true;
  }

  async function tryEmitLocalCompanionLine(
    context: string,
    options: {
      plannedCheckMinSilenceMs?: number;
      kindCooldownMs?: number;
      skipScore?: boolean;
      localDecision?: LocalInitiativeDecision;
    } = {},
  ): Promise<boolean> {
    return emitLocalCompanionLine({
      scoreContext: context,
      plannedCheckMinSilenceMs: options.plannedCheckMinSilenceMs,
      kindCooldownMs: options.kindCooldownMs,
      skipScore: options.skipScore,
      localDecision: options.localDecision,
      riskToleranceBonus: options.skipScore ? undefined : 1,
    });
  }

  const GENERIC_COMPANION_DECISION: LocalInitiativeDecision = {
    allowed: true,
    reason: "общая проверка присутствия",
    annoyanceRisk: "low",
    value: "medium",
  };

  async function trySignalDrivenAdviceInitiative(input: {
    signalBundle: ReturnType<typeof buildInitiativeSignalBundle>;
    urgency: ReturnType<typeof scoreAdviceUrgency>;
    plannedSilenceMs: number;
  }): Promise<boolean> {
    const plan = planSignalDrivenAdvice(input.signalBundle, input.urgency);
    const pkg = await prepareProactivePackage(plan.kind, {
      ...proactiveBundleOptions({ urgency: input.urgency }),
      advisorAngle: plan.angle,
      conversationTopics: plan.conversationTopics,
    });
    if (!pkg) {
      return false;
    }
    const sent = await launchProactiveInitiative(pkg, {
      ignoreKindDailyCap: true,
      kindCooldownMs: input.urgency.effectiveIntervalMs,
      plannedCheckMinSilenceMs: input.plannedSilenceMs,
    });
    if (sent) {
      const subject =
        input.urgency.subjectKey ?? plan.anchor ?? pkg.initiativeAnchor;
      if (subject) {
        rememberAdviceSubject(subject);
      }
    }
    return sent;
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
    const plannedCheckContext =
      "Плановая проверка инициативы после периода тишины.";

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
      const sent = await launchProactiveInitiative(pkg, {
        kindCooldownMs,
        plannedCheckMinSilenceMs: input.plannedSilenceMs,
      });
      return sent;
    }

    if (!shouldUseIdleLineFallback(settings, input.llmOnline)) {
      return false;
    }

    return emitLocalCompanionLine({
      scoreContext: plannedCheckContext,
      skipScore: true,
      localDecision: GENERIC_COMPANION_DECISION,
      initiativeKind: "check_in",
      kindCooldownMs,
      plannedCheckMinSilenceMs: input.plannedSilenceMs,
      ambientTimeoutMs: 8000,
    });
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
      const existingBundle = options.llmBundle ?? options.linkSynthesis;
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
          linkSynthesis: existingBundle,
        };
      } else {
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
      });
      let ragSnippets: string[] = [];
      if (
        settings.ragEnabled &&
        tone === "advice" &&
        (hasProactiveDebugSignals(bundle) || bundle.clipboardSnippets.length > 0)
      ) {
        try {
          const ragQuery = buildProactiveWebSearchQuery(
            bundle,
            preliminaryAnchor,
          );
          const ragHits = await searchRag(ragQuery, settings);
          ragSnippets = ragHits
            .slice(0, 3)
            .map((hit) => hit.text.trim().slice(0, 200))
            .filter(Boolean);
        } catch {
          ragSnippets = [];
        }
      }
      const adviceFacts = collectProactiveSignalFacts({
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
      });
      const adviceTopicKey = buildAdviceTopicKey({
        anchor: preliminaryAnchor,
        processName: mergedOpts.processName,
        windowTitle: mergedOpts.windowTitle,
        signalSummary: mergedOpts.urgency?.reasons.join("; "),
      });
      const advicePlan =
        tone === "advice"
          ? planAdvice({
              bundle,
              facts: adviceFacts,
              urgency: mergedOpts.urgency,
              feedback: getRecentAdviceFeedback(adviceTopicKey),
              candidateTopics,
              ragSnippets,
            })
          : null;
      let llmBundle = await synthesizeProactiveBundle(settings, {
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
        adviceCandidate: advicePlan?.selected,
      });
      if (
        llmBundle.tone === "advice" &&
        !llmBundle.practicalHook &&
        !(llmBundle.adviceSteps && llmBundle.adviceSteps.length)
      ) {
        const retry = await synthesizeProactiveBundle(settings, {
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
          adviceCandidate: advicePlan?.selected,
        });
        if (retry.practicalHook || retry.adviceSteps?.length) {
          llmBundle = retry;
        }
      }
      if (!llmBundle.shouldSend) {
        if (kind === "check_in" || kind === "quiet_presence") {
          const offlineBundle = await synthesizeProactiveBundle(settings, {
            bundle,
            tone: llmBundle.tone,
            bannedTopics: banned,
            candidateTopics,
            sessionMinutes: mergedOpts.sessionMinutes,
            windowMinutes: mergedOpts.windowMinutes,
            companionSilenceMs: mergedOpts.companionSilenceMs,
            recentUserMessage: mergedOpts.recentUserMessage,
            urgency: mergedOpts.urgency,
            recentChatTurns: mergedOpts.recentChatTurns,
            llmOnline: false,
            ragSnippets: ragSnippets.length ? ragSnippets : undefined,
            adviceCandidate: advicePlan?.selected,
          });
          if (offlineBundle.shouldSend) {
            llmBundle = offlineBundle;
          }
        }
      }
      if (!llmBundle.shouldSend) {
        recordInitiativeSuppressed(
          llmBundle.rejectReason ?? "llm bundle rejected",
        );
        return null;
      }
      packageOptions = {
        ...packageOptions,
        conversationTopics:
          llmBundle.linkedThemes.length > 0
            ? llmBundle.linkedThemes
            : candidateTopics,
        llmBundle,
        linkSynthesis: llmBundle,
      };
      }
    }

    return buildProactiveInitiativePackage(settings, kind, packageOptions);
  }

  async function launchProactiveInitiative(
    pkg: ProactiveInitiativePackage,
    extra: {
      ignoreKindDailyCap?: boolean;
      kindCooldownMs?: number;
      plannedCheckMinSilenceMs?: number;
    } = {},
  ): Promise<boolean> {
    if (pkg.proactiveReplyTone === "advice") {
      refreshAdviceTopicState({
        anchor: pkg.initiativeAnchor,
        processName: activeWindowRef.current?.processName,
        windowTitle: activeWindowRef.current?.title,
        signalSummary: pkg.proactiveSignalSummary,
      });
    }
    return attemptInitiative(pkg.eventDescription, pkg.initiativeKind, {
      initiativeAnchor: pkg.initiativeAnchor,
      softInitiativeAnchor: pkg.softInitiativeAnchor ?? true,
      bannedProactiveTopics: pkg.bannedProactiveTopics,
      plannedCheckFreshTopics: pkg.plannedCheckFreshTopics,
      skipLlmGate: pkg.skipLlmGate,
      proactiveReplyTone: pkg.proactiveReplyTone,
      advisorAngle: pkg.advisorAngle,
      proactiveSignalSummary: pkg.proactiveSignalSummary,
      gateContext: pkg.llmBundle
        ? buildGateContextFromBundle(pkg.llmBundle)
        : pkg.linkSynthesis
          ? buildGateContextFromBundle(pkg.linkSynthesis)
          : undefined,
      proactiveLinkNarrative:
        pkg.llmBundle?.primaryChainSummary ??
        pkg.linkSynthesis?.primaryChainSummary ??
        pkg.llmBundle?.narrativeBrief ??
        pkg.linkSynthesis?.narrativeBrief,
      proactivePracticalHook: pkg.llmBundle?.practicalHook ?? pkg.linkSynthesis?.practicalHook,
      proactiveInitiativeMove:
        pkg.llmBundle?.initiativeMove ?? pkg.linkSynthesis?.initiativeMove,
      ignoreKindDailyCap: extra.ignoreKindDailyCap,
      kindCooldownMs: extra.kindCooldownMs,
      plannedCheckMinSilenceMs: extra.plannedCheckMinSilenceMs,
    });
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
      proactiveInitiativeMove?: string;
    } = {},
  ): Promise<boolean> {
    const interruptibility = resolveInterruptibilityTier();
    const initiativeKind =
      forcedKind ?? classifyInitiativeKind(eventDescription);

    if (!allowsInitiativeForKind(interruptibility, initiativeKind)) {
      recordInitiativeSuppressed("interruptibility blocks initiative");
      ariLog("initiative", "debug", {
        stage: "suppressed",
        description: eventDescription,
        reason: "interruptibility blocks initiative",
        interruptibility: describeInterruptibility(interruptibility),
        initiativeKind,
      });
      return false;
    }

    if (
      gateBusyRef.current ||
      isLoadingRef.current ||
      isQuietHours(settings) ||
      isQuietModeActive(settings, activeWindow) ||
      blocksInitiative(lifecycle)
    ) {
      recordInitiativeSuppressed("busy, offline, quiet mode, or lifecycle gate");
      ariLog("initiative", "debug", {
        stage: "suppressed",
        description: eventDescription,
        reason: "busy, offline, quiet mode, or lifecycle gate",
        interruptibility: describeInterruptibility(interruptibility),
      });
      return false;
    }

    if (
      !canUseInitiativeKind(initiativeKind, {
        cooldownMs: options.kindCooldownMs,
      })
    ) {
      recordInitiativeSuppressed(`cooldown for ${initiativeKind}`);
      return false;
    }
    if (
      !options.ignoreKindDailyCap &&
      isDailyKindCapReached(
        initiativeKind,
        dailyInitiativeKindCap(initiativeKind, settings),
      )
    ) {
      recordInitiativeSuppressed(`daily cap for ${initiativeKind}`);
      return false;
    }
    const openLoopHint = topOpenLoopRef.current;
    const userIntent = settings.intentClassifierEnabled
      ? classifyUserIntent(eventDescription).intent
      : undefined;
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
        options.plannedCheckMinSilenceMs ?? proactiveIntervalMs(settings),
      openLoopHint,
      mood,
      intent: userIntent,
      adaptiveEnabled: settings.adaptiveInitiativeEnabled,
      plannedCheckFreshTopics: options.plannedCheckFreshTopics,
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
      recordInitiativeSuppressed(localDecision.reason);
      return false;
    }
    gateBusyRef.current = true;
    try {
      if (!isLlmProviderOnline(settings, ollamaOnline)) {
        if (
          initiativeKind === "check_in" ||
          options.proactiveReplyTone === "smalltalk"
        ) {
          return emitLocalCompanionLine({
            scoreContext: eventDescription,
            skipScore: true,
            localDecision: {
              allowed: true,
              reason: "LLM недоступен — запасная реплика",
              annoyanceRisk: "low",
              value: "low",
            },
            initiativeKind,
            kindCooldownMs: options.kindCooldownMs,
            plannedCheckMinSilenceMs: options.plannedCheckMinSilenceMs,
            plannedAnchor: options.initiativeAnchor,
            ambientTimeoutMs: 8000,
          });
        }
        recordInitiativeSuppressed("llm offline");
        return false;
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
          recordInitiativeSuppressed(
            `relevance gate: ${decision.topic || "no topic"}`,
          );
          ariLog("initiative", "debug", {
            stage: "suppressed",
            description: eventDescription,
            reason: `relevance gate: ${decision.topic || "no topic"}`,
            interruptibility: describeInterruptibility(interruptibility),
          });
          return false;
        }
        topic = decision.topic || eventDescription;
      }

      ariLog("initiative", "debug", {
        stage: "sent",
        description: eventDescription,
        reason: topic,
        interruptibility: describeInterruptibility(interruptibility),
      });
      if (!isOpen && !settings.proactiveOpenChat) {
        onAmbientBubble?.(topic.slice(0, 80));
      }
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
        proactiveInitiativeMove: options.proactiveInitiativeMove,
      });
      if (sent) {
        setLastProactiveMessageAt();
        markInitiativeKind(initiativeKind);
        markInitiativeSent(
          lastInitiativeFeaturesRef.current ?? undefined,
          settings.adaptiveInitiativeEnabled,
          initiativeKind,
        );
        if (options.proactiveReplyTone === "advice") {
          const subject = options.initiativeAnchor;
          if (subject) {
            rememberAdviceSubject(subject);
          }
        }
      }
      return sent;
    } catch (gateError) {
      logError("Initiative gate failed", gateError);
      return false;
    } finally {
      gateBusyRef.current = false;
    }
  }

  useEffect(() => {
    if (!settings.proactiveEnabled) {
      proactiveWasEnabledRef.current = false;
      return;
    }

    const intervalMs = proactiveIntervalMs(settings);
    ensureProactiveClockStarted(intervalMs);
    if (!proactiveWasEnabledRef.current) {
      armProactiveGracePeriod(intervalMs);
      proactiveWasEnabledRef.current = true;
    }
    if (lastProactiveIntervalRef.current !== settings.proactiveIntervalMinutes) {
      armProactiveGracePeriod(intervalMs);
      lastProactiveIntervalRef.current = settings.proactiveIntervalMinutes;
    }

    const checkInitiative = async () => {
      if (isQuietModeActive(settings, activeWindowRef.current)) {
        return;
      }
      if (isQuietHours(settings)) {
        return;
      }
      if (blocksInitiative(lifecycleRef.current)) {
        return;
      }
      const requiredIdleMs = Math.min(2 * 60 * 1000, intervalMs);
      const activityAgoMs = Math.max(
        Date.now() - lastUserActivityRef.current,
        userIdleSecondsRef.current * 1000,
      );
      const companionSilenceMs = getCompanionSilenceMs();
      const proactiveTiming = getProactiveTiming();
      const sessionMs = proactiveTiming.sessionMs;
      const immersedCompanion =
        companionSilenceMs >= COMPANION_SILENCE_MIN_MS &&
        sessionMs >= COMPANION_SESSION_MIN_MS &&
        Boolean(activeWindowRef.current) &&
        settings.activityTrackingEnabled;
      const llmOnline = isLlmProviderOnline(settings, ollamaOnline);
      const activeLevel = settings.initiativeLevel === "active";
      const plannedSilenceMs = requiredIdleMs;

      if (
        isLoadingRef.current ||
        (!immersedCompanion && activityAgoMs < requiredIdleMs)
      ) {
        return;
      }

      const signalBundle = buildInitiativeSignalBundle(settings, {
        sessionMinutes: proactiveTiming.sessionMinutes,
        windowMinutes: proactiveTiming.windowMinutes,
        processName: activeWindowRef.current?.processName,
        windowTitle: activeWindowRef.current?.title,
        visionObservation: lastVisionObservationRef.current,
      });
      const urgency = scoreAdviceUrgency(signalBundle, settings, {
        sessionMinutes: proactiveTiming.sessionMinutes,
        userIntervalMs: intervalMs,
      });
      setLastAdviceUrgency(urgency);

      const sinceAttempt = Date.now() - getLastProactiveAttemptAt();
      const workContext = isProactiveWorkContext({
        bundle: signalBundle,
        sessionMinutes: proactiveTiming.sessionMinutes,
      });
      const adviceReady =
        settings.advisorEnabled &&
        llmOnline &&
        isAdviceReady(urgency, sinceAttempt);
      const presenceReady = sinceAttempt >= intervalMs;
      const idleGateOpen =
        immersedCompanion || activityAgoMs >= requiredIdleMs;
      const tickAction = evaluateProactiveTick({
        adviceReady,
        presenceReady,
        idleGateOpen,
        loading: isLoadingRef.current,
      });

      if (tickAction === "silent") {
        return;
      }

      if (tickAction === "try_advice") {
        const sent = await trySignalDrivenAdviceInitiative({
          signalBundle,
          urgency,
          plannedSilenceMs,
        });
        const nextAction = afterAdviceAttempt({
          adviceSent: sent,
          presenceReady,
        });
        if (nextAction === "silent") {
          setLastProactiveAttemptAt();
          return;
        }
        if (nextAction === "retry_advice_later") {
          setLastProactiveAttemptAt();
          return;
        }
      }

      if (!presenceReady) {
        return;
      }

      const ritualPending = getPendingDailyRitual() !== null;
      const longSilence = activityAgoMs >= 20 * 60_000;
      const tryMemory =
        ritualPending ||
        longSilence ||
        (!activeLevel && Math.random() < 0.18);

      if (
        !workContext &&
        urgency.level === "none" &&
        settings.userMemoryEnabled &&
        tryMemory &&
        canUseInitiativeKind("memory_callback", { cooldownMs: intervalMs })
      ) {
        const pkg = await buildMemoryCallbackPackage(
          settings,
          historyRef.current
            .slice()
            .reverse()
            .find((message) => message.role === "user")?.content ?? "",
          proactiveBundleOptions(),
        );
        if (pkg) {
          const sent = await launchProactiveInitiative(pkg, {
            ignoreKindDailyCap: true,
            kindCooldownMs: intervalMs,
            plannedCheckMinSilenceMs: plannedSilenceMs,
          });
          if (sent) {
            setLastProactiveAttemptAt();
            return;
          }
        }
      }

      if (
        !activeLevel &&
        Math.random() < 0.1 &&
        canUseInitiativeKind("unfinished_thread", { cooldownMs: intervalMs })
      ) {
        const nudge = getHighPriorityOpenTasks()[0] ?? getNextTask();
        if (nudge && !nudge.dueAt) {
          const pkg = buildProactiveInitiativePackage(
            settings,
            "unfinished_thread",
            {
              ...proactiveBundleOptions(),
              taskTitle: nudge.title,
              taskNotes: nudge.notes,
            },
          );
          const sent = await launchProactiveInitiative(pkg, {
            kindCooldownMs: intervalMs,
            plannedCheckMinSilenceMs: plannedSilenceMs,
          });
          if (sent) {
            setLastProactiveAttemptAt();
            return;
          }
        }
      }

      const generic = await tryGenericCompanionInitiative({
        activityAgoMs,
        intervalMs,
        plannedSilenceMs,
        llmOnline,
        immersedCompanion,
        companionSilenceMs,
      });
      if (generic) {
        setLastProactiveAttemptAt();
      }
    };

    const timer = window.setInterval(checkInitiative, 15_000);
    return () => window.clearInterval(timer);
  }, [
    settings.proactiveEnabled,
    settings.proactiveIntervalMinutes,
    settings.proactiveOpenChat,
    settings.initiativeLevel,
    settings.userMemoryEnabled,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.adaptiveInitiativeEnabled,
    settings.advisorEnabled,
    settings.activityTrackingEnabled,
    ollamaOnline,
  ]);

  useEffect(() => {
    const runPrune = () => {
      const ignored = pruneExpiredPendingInitiatives(
        settings.adaptiveInitiativeEnabled,
      );
      if (ignored > 0) {
        onMoodInteraction?.("ignored_initiative");
      }
    };
    runPrune();
    const timer = window.setInterval(runPrune, 60_000);
    return () => window.clearInterval(timer);
  }, [settings.adaptiveInitiativeEnabled, onMoodInteraction]);

  useEffect(() => {
    if (!settings.autoVisionEnabled || !settings.activityTrackingEnabled) {
      return;
    }

    let timer: number;
    const schedule = () => {
      const delay = 8 * 60_000 + Math.random() * 12 * 60_000;
      timer = window.setTimeout(() => {
        void runAutoVisionGlance().finally(schedule);
      }, delay);
    };

    schedule();
    return () => window.clearTimeout(timer);
  }, [
    settings.autoVisionEnabled,
    settings.activityTrackingEnabled,
    settings.activityAllowlist,
    settings.visualMemoryMinutes,
    settings.proactiveOpenChat,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    activeWindow,
    ollamaOnline,
    characterState,
  ]);

  useEffect(() => {
    const processBridge = () => {
      if (!settings.proactiveEnabled) {
        drainProactiveRequests();
        return;
      }
      for (const req of drainProactiveRequests()) {
        void prepareProactivePackage(req.kind, {
          ...proactiveBundleOptions(),
          eventHint: req.eventHint,
          ...req.options,
        }).then((pkg) => {
          if (!pkg) {
            return;
          }
          void launchProactiveInitiative(pkg, {
            ignoreKindDailyCap: req.lab,
          }).then((sent) => {
            if (sent && req.scenario) {
              markScenarioTriggered(req.scenario);
            }
          });
        });
      }
    };
    const unsub = subscribeProactiveRequests(processBridge);
    processBridge();
    return unsub;
  }, [
    settings.proactiveEnabled,
    settings.advisorEnabled,
    settings.activityTrackingEnabled,
    ollamaOnline,
    isOpen,
  ]);

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
          void launchProactiveInitiative(pkg).then((sent) => {
            if (sent) {
              setLastProactiveAttemptAt();
            }
          });
        });
        return;
      }
      void tryEmitLocalCompanionLine(context).then((local) => {
        if (local) {
          setLastProactiveAttemptAt();
        }
      });
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
            <VisionCropper
              capture={pendingCrop}
              onConfirm={(selection) => void analyzeCrop(selection)}
              onCancel={() => {
                pendingCrop.imageBase64 = "";
                setPendingCrop(null);
              }}
            />
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
                          className={`message-menu-button${
                            openBranchMenuIndex === index ? " active" : ""
                          }`}
                          aria-label="Действия с ответом"
                          aria-expanded={openBranchMenuIndex === index}
                          onClick={(event) => {
                            event.stopPropagation();
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

            {proactiveNotice && (
              <div className="chat-notice" role="status">
                {proactiveNotice}
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setProactiveNotice(null)}
                >
                  Закрыть
                </button>
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
