import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { ChatMessage } from "../types/chat";
import type { CharacterState } from "../types/character";
import {
  buildInitiativeSignalBundle,
  buildProactiveInitiativePackage,
  ProactiveInitiativePackage,
  ProactivePackageOptions,
} from "../character/initiativeContext";
import { canUseInitiativeKind, type InitiativeKind } from "../character/initiativeKinds";
import {
  markInitiativeAcknowledged,
  pruneExpiredPendingInitiatives,
  getRecentIgnoredInitiativeCount,
  recordInitiativeOutcome,
  type InitiativeFeatureVector,
} from "../character/initiativeScoring";
import {
  scoreAdviceUrgency,
  setLastAdviceUrgency,
} from "../character/adviceUrgency";
import {
  isAdviceGenerationFailure,
  type AdviceDecision,
} from "../character/adviceEngine";
import { ADVICE_IGNORED_EVENT } from "../character/adviceOutcome";
import {
  drainProactiveRequests,
  subscribeProactiveRequests,
} from "../character/proactiveBridge";
import {
  canEmitAdviceNow,
  canEmitSmalltalkNow,
  ensureProactiveClockStarted,
  getLastAdviceAttemptAt,
  getLastSmalltalkAttemptAt,
  getProactiveFailureBackoff,
  markAdviceAttemptAt,
  recordAdviceDecision,
  registerProactiveFailure,
  shouldSuppressOpenChatAdvice,
} from "../character/proactiveState";
import {
  isProactiveActivityGateOpen,
  planProactiveEngineTick,
} from "../character/proactiveEngine";
import {
  ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS,
  idleLineProbability,
  proactiveAdviceIntervalMs,
  proactiveSmalltalkIntervalMs,
} from "../character/initiativeConfig";
import { isQuietModeActive } from "../character/quietMode";
import { isQuietHours } from "../character/reminders";
import { getPendingDailyRitual } from "../character/dailyRituals";
import { blocksInitiative, type LifecycleState } from "../character/lifecycle";
import { getCompanionSilenceMs } from "../platform/userActivity";
import { isProactiveWorkContext } from "../character/proactiveTone";
import { getProactiveToneSnapshot } from "../memory/memoryTelemetry";
import { markScenarioTriggered } from "../character/scenarioEngine";
import { countRecentAdviceStreak } from "../character/adviceLedger";
import { buildMemoryCallbackPackage } from "../memory/memoryProactive";
import { getHighPriorityOpenTasks, getNextTask } from "../tasks/taskStore";
import { loadProactiveRuntime } from "./chatRuntimeLoaders";
import { isLlmProviderOnline } from "../llm/providerOnline";
import type { Clock, RandomSource } from "../character/runtimePrimitives";
import {
  randomChance,
  randomJitterMs,
  systemClock,
  systemRandom,
} from "../character/runtimePrimitives";
import {
  AUTO_VISION_JITTER_MS,
  AUTO_VISION_MIN_DELAY_MS,
  PROACTIVE_ADVICE_STREAK_MEMORY_BOOST,
  PROACTIVE_ADVICE_STREAK_THREAD_BOOST,
  PROACTIVE_BASE_UNFINISHED_THREAD_PROBABILITY,
  PROACTIVE_IMMERSED_COMPANION_SESSION_MIN_MS,
  PROACTIVE_IMMERSED_COMPANION_SILENCE_MIN_MS,
  PROACTIVE_LOOP_TICK_MS,
  PROACTIVE_MAX_MEMORY_CALLBACK_PROBABILITY,
  PROACTIVE_MAX_UNFINISHED_THREAD_PROBABILITY,
  PROACTIVE_PRUNE_TICK_MS,
} from "../character/proactivePolicyConfig";
import {
  createProactiveTimerController,
  type ProactiveTimerController,
} from "./proactiveTimerController";
import {
  useLatestRef,
  useStableCallbackRef,
} from "./useStableCallbackRef";

type InitiativeLaunchResult = { sent: boolean; suppressReason?: string };

export function useProactiveInitiative(input: {
  settings: AppSettings;
  activeWindow: ActiveWindowInfo | null;
  ollamaOnline: boolean | null;
  isOpen: boolean;
  characterState: CharacterState;
  historyRef: RefObject<ChatMessage[]>;
  activeWindowRef: RefObject<ActiveWindowInfo | null>;
  lifecycleRef: RefObject<LifecycleState>;
  userIdleSecondsRef: RefObject<number>;
  lastUserActivityRef: RefObject<number>;
  lastVisionObservationRef: RefObject<{ text: string; timestamp: number } | null>;
  isLoadingRef: RefObject<boolean>;
  proactiveWasEnabledRef: RefObject<boolean>;
  lastProactiveIntervalRef: RefObject<string>;
  lastInitiativeFeaturesRef: RefObject<InitiativeFeatureVector | null>;
  getProactiveTiming: () => {
    sessionMs: number;
    sessionMinutes: number;
    windowMinutes: number;
  };
  proactiveBundleOptions: (
    extra?: ProactivePackageOptions,
  ) => ProactivePackageOptions;
  prepareProactivePackage: (
    kind: InitiativeKind,
    options?: ProactivePackageOptions,
  ) => Promise<ProactiveInitiativePackage | null>;
  launchProactiveInitiative: (
    pkg: ProactiveInitiativePackage,
    extra?: {
      ignoreKindDailyCap?: boolean;
      kindCooldownMs?: number;
      plannedCheckMinSilenceMs?: number;
      engineApproved?: boolean;
    },
  ) => Promise<InitiativeLaunchResult>;
  launchAdviceFromEngine: (
    decision: AdviceDecision,
    plannedSilenceMs: number,
    urgency: ReturnType<typeof scoreAdviceUrgency>,
  ) => Promise<boolean>;
  tryGenericCompanionInitiative: (input: {
    activityAgoMs: number;
    intervalMs: number;
    plannedSilenceMs: number;
    llmOnline: boolean;
    immersedCompanion: boolean;
    companionSilenceMs: number;
  }) => Promise<boolean>;
  runAutoVisionGlance: () => Promise<boolean>;
  clock?: Clock;
  random?: RandomSource;
}) {
  const {
    settings,
    activeWindow,
    ollamaOnline,
    isOpen,
    characterState,
    historyRef,
    activeWindowRef,
    lifecycleRef,
    userIdleSecondsRef,
    lastUserActivityRef,
    lastVisionObservationRef,
    isLoadingRef,
    proactiveWasEnabledRef,
    lastProactiveIntervalRef,
    lastInitiativeFeaturesRef,
    getProactiveTiming,
    proactiveBundleOptions,
    prepareProactivePackage,
    launchProactiveInitiative,
    launchAdviceFromEngine,
    tryGenericCompanionInitiative,
    runAutoVisionGlance,
    clock = systemClock,
    random = systemRandom,
  } = input;
  const getProactiveTimingRef = useLatestRef(getProactiveTiming);
  const proactiveBundleOptionsRef = useLatestRef(proactiveBundleOptions);
  const prepareProactivePackageRef = useLatestRef(prepareProactivePackage);
  const launchProactiveInitiativeRef = useLatestRef(launchProactiveInitiative);
  const launchAdviceFromEngineRef = useLatestRef(launchAdviceFromEngine);
  const tryGenericCompanionInitiativeRef = useLatestRef(tryGenericCompanionInitiative);
  const runAutoVisionGlanceRef = useLatestRef(runAutoVisionGlance);
  const clockRef = useLatestRef(clock);
  const randomRef = useLatestRef(random);
  const proactiveTimerRef = useRef<ProactiveTimerController | null>(null);

  const recordUserAcknowledgedInitiative = useCallback(() => {
    if (
      settings.adaptiveInitiativeEnabled &&
      lastInitiativeFeaturesRef.current &&
      getRecentIgnoredInitiativeCount() > 0
    ) {
      recordInitiativeOutcome(lastInitiativeFeaturesRef.current, true);
    }
    markInitiativeAcknowledged();
  }, [lastInitiativeFeaturesRef, settings.adaptiveInitiativeEnabled]);

  const checkInitiativeRef = useStableCallbackRef(async () => {
      const now = clockRef.current.now();
      if (isQuietModeActive(settings, activeWindowRef.current)) {
        recordAdviceDecision("tick -> blocked: quiet mode");
        return;
      }
      if (isQuietHours(settings)) {
        recordAdviceDecision("tick -> blocked: quiet hours");
        return;
      }
      if (blocksInitiative(lifecycleRef.current)) {
        recordAdviceDecision("tick -> blocked: lifecycle");
        return;
      }
      const activityAgoMs = Math.max(
        now - lastUserActivityRef.current,
        userIdleSecondsRef.current * 1000,
      );
      const companionSilenceMs = getCompanionSilenceMs();
      const proactiveTiming = getProactiveTimingRef.current();
      const sessionMs = proactiveTiming.sessionMs;
      const immersedCompanion =
        companionSilenceMs >= PROACTIVE_IMMERSED_COMPANION_SILENCE_MIN_MS &&
        sessionMs >= PROACTIVE_IMMERSED_COMPANION_SESSION_MIN_MS &&
        Boolean(activeWindowRef.current) &&
        settings.activityTrackingEnabled;
      const llmOnline = isLlmProviderOnline(settings, ollamaOnline);
      const adviceIntervalMs = proactiveAdviceIntervalMs(settings);
      const smalltalkIntervalMs = proactiveSmalltalkIntervalMs(settings);
      const activeLevel = settings.initiativeLevel === "active";
      const adviceIdleMs = Math.min(2 * 60 * 1000, smalltalkIntervalMs);
      const smalltalkIdleMs =
        activeLevel && isOpen
          ? ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS
          : adviceIdleMs;
      const canEvaluateAdvice = isProactiveActivityGateOpen({
        activeLevel,
        immersedCompanion,
        activityAgoMs,
        requiredIdleMs: adviceIdleMs,
      });
      const canEvaluateSmalltalk = isProactiveActivityGateOpen({
        activeLevel,
        immersedCompanion,
        activityAgoMs,
        requiredIdleMs: smalltalkIdleMs,
      });
      const plannedSilenceMs = adviceIdleMs;
      const smalltalkPlannedSilenceMs =
        activeLevel && isOpen
          ? ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS
          : plannedSilenceMs;

      if (
        isLoadingRef.current ||
        (!canEvaluateSmalltalk && !canEvaluateAdvice)
      ) {
        recordAdviceDecision(
          isLoadingRef.current
            ? "tick -> blocked: generation busy"
            : "tick -> blocked: activity gate",
        );
        return;
      }

      const basePackageOptions = proactiveBundleOptionsRef.current();
      const signalBundle = buildInitiativeSignalBundle(settings, {
        sessionMinutes: proactiveTiming.sessionMinutes,
        windowMinutes: proactiveTiming.windowMinutes,
        processName: activeWindowRef.current?.processName,
        windowTitle: activeWindowRef.current?.title,
        visionObservation: lastVisionObservationRef.current,
        ideEditorFile: basePackageOptions.ideEditorFile,
      });
      const urgency = scoreAdviceUrgency(signalBundle, settings, {
        sessionMinutes: proactiveTiming.sessionMinutes,
        userIntervalMs: adviceIntervalMs,
      });
      setLastAdviceUrgency(urgency);

      const sinceAdviceAttempt = now - getLastAdviceAttemptAt();
      const sinceSmalltalkAttempt = now - getLastSmalltalkAttemptAt();
      const smalltalkReady =
        canEvaluateSmalltalk &&
        sinceSmalltalkAttempt >= smalltalkIntervalMs &&
        canEmitSmalltalkNow(settings, now);
      const adviceChannelReady =
        canEvaluateAdvice && canEmitAdviceNow(settings, now);
      const idleGateOpen = canEvaluateAdvice;
      const toneSnapshot = getProactiveToneSnapshot(now);
      const workContext = isProactiveWorkContext({
        bundle: signalBundle,
        sessionMinutes: proactiveTiming.sessionMinutes,
      });
      const engineDecision = planProactiveEngineTick({
        settings,
        bundle: signalBundle,
        urgency,
        llmOnline,
        idleGateOpen,
        loading: isLoadingRef.current,
        smalltalkReady,
        sinceAdviceAttemptMs: sinceAdviceAttempt,
        adviceIntervalMs,
        toneSnapshot,
        recentAdviceStreak: countRecentAdviceStreak(),
      });
      const tickAction = engineDecision.action;

      if (tickAction === "silent") {
        recordAdviceDecision(`tick -> silent: ${engineDecision.reason}`);
        return;
      }

      const allowSmalltalk = engineDecision.allowSmalltalk;

      if (tickAction === "try_advice") {
        if (!adviceChannelReady) {
          recordAdviceDecision("tick -> advice blocked: cross-channel gap");
          return;
        }
        const adviceUrgency = engineDecision.adviceUrgency;
        if (
          shouldSuppressOpenChatAdvice({
            chatOpen: isOpen,
            activityAgoMs,
            urgencyLevel: adviceUrgency.level,
            settings,
          })
        ) {
          recordAdviceDecision("tick -> advice blocked: open-chat activity gate");
          return;
        }
        if (getProactiveFailureBackoff(now)) {
          recordAdviceDecision("tick -> advice blocked: generation backoff");
          return;
        }
        const { runAdviceCycle } = await loadProactiveRuntime();
        const decision = await runAdviceCycle({
          settings,
          bundle: signalBundle,
          urgency: adviceUrgency,
          packageOptions: {
            ...basePackageOptions,
            urgency: adviceUrgency,
          },
          llmOnline,
          advisorEnabled: settings.advisorEnabled,
          sinceAdviceAttemptMs: sinceAdviceAttempt,
          adviceIntervalMs,
          now,
          safety: {
            idleGateOpen,
            loading: isLoadingRef.current,
          },
        });
        if (decision.deliver) {
          await launchAdviceFromEngineRef.current(
            decision,
            plannedSilenceMs,
            adviceUrgency,
          );
        } else {
          recordAdviceDecision(
            `engine -> ${decision.strategy}: ${decision.reason}`,
          );
          const generationFailed = isAdviceGenerationFailure(decision);
          if (
            generationFailed ||
            (decision.strategy !== "SILENT" &&
              decision.strategy !== "DEFER_SMALLTALK")
          ) {
            // A completed generation attempt must count even when no text was
            // emitted, otherwise a fresh signal bypasses cadence every tick.
            markAdviceAttemptAt(now);
          }
          if (generationFailed) {
            registerProactiveFailure(
              decision.bundle?.rejectReason ?? decision.reason,
              now,
            );
          }
        }
        return;
      }

      if (!smalltalkReady || !allowSmalltalk) {
        return;
      }

      const ritualPending = getPendingDailyRitual() !== null;
      const longSilence = activityAgoMs >= 20 * 60_000;
      const adviceStreak = countRecentAdviceStreak();
      const memoryRollBoost =
        adviceStreak >= 2
          ? PROACTIVE_ADVICE_STREAK_MEMORY_BOOST.many
          : adviceStreak >= 1
            ? PROACTIVE_ADVICE_STREAK_MEMORY_BOOST.one
            : 0;
      const tryMemory =
        ritualPending ||
        longSilence ||
        (!activeLevel &&
          randomChance(
            randomRef.current,
            Math.min(
              PROACTIVE_MAX_MEMORY_CALLBACK_PROBABILITY,
              idleLineProbability(settings) + memoryRollBoost,
            ),
          ));

      if (
        !workContext &&
        urgency.level === "none" &&
        settings.userMemoryEnabled &&
        tryMemory &&
        canUseInitiativeKind("memory_callback", { cooldownMs: smalltalkIntervalMs })
      ) {
        const pkg = await buildMemoryCallbackPackage(
          settings,
          historyRef.current
            .slice()
            .reverse()
            .find((message) => message.role === "user")?.content ?? "",
          proactiveBundleOptionsRef.current(),
        );
        if (pkg) {
          const { sent } = await launchProactiveInitiativeRef.current(pkg, {
            ignoreKindDailyCap: true,
            kindCooldownMs: smalltalkIntervalMs,
            plannedCheckMinSilenceMs: smalltalkPlannedSilenceMs,
          });
          if (sent) {
            return;
          }
        }
      }

      if (
        !activeLevel &&
        randomChance(
          randomRef.current,
          Math.min(
            PROACTIVE_MAX_UNFINISHED_THREAD_PROBABILITY,
            PROACTIVE_BASE_UNFINISHED_THREAD_PROBABILITY +
              (adviceStreak >= 2
                ? PROACTIVE_ADVICE_STREAK_THREAD_BOOST.many
                : adviceStreak >= 1
                  ? PROACTIVE_ADVICE_STREAK_THREAD_BOOST.one
                  : 0),
          ),
        ) &&
        canUseInitiativeKind("unfinished_thread", { cooldownMs: smalltalkIntervalMs })
      ) {
        const nudge = getHighPriorityOpenTasks()[0] ?? getNextTask();
        if (nudge && !nudge.dueAt) {
          const pkg = buildProactiveInitiativePackage(
            settings,
            "unfinished_thread",
            {
              ...proactiveBundleOptionsRef.current(),
              taskTitle: nudge.title,
              taskNotes: nudge.notes,
            },
          );
          const { sent } = await launchProactiveInitiativeRef.current(pkg, {
            kindCooldownMs: smalltalkIntervalMs,
            plannedCheckMinSilenceMs: smalltalkPlannedSilenceMs,
          });
          if (sent) {
            return;
          }
        }
      }

      const generic = await tryGenericCompanionInitiativeRef.current({
        activityAgoMs,
        intervalMs: smalltalkIntervalMs,
        plannedSilenceMs: smalltalkPlannedSilenceMs,
        llmOnline,
        immersedCompanion,
        companionSilenceMs,
      });
      void generic;
    });

  useEffect(() => {
    if (!settings.proactiveEnabled) {
      proactiveWasEnabledRef.current = false;
      proactiveTimerRef.current?.stop();
      return;
    }

    const adviceIntervalMs = proactiveAdviceIntervalMs(settings);
    const smalltalkIntervalMs = proactiveSmalltalkIntervalMs(settings);
    const now = clockRef.current.now();
    ensureProactiveClockStarted(adviceIntervalMs, smalltalkIntervalMs, now);
    proactiveWasEnabledRef.current = true;
    const intervalKey = `${settings.proactiveAdviceIntervalMinutes}:${settings.proactiveSmalltalkIntervalMinutes}`;
    if (lastProactiveIntervalRef.current !== intervalKey) {
      lastProactiveIntervalRef.current = intervalKey;
    }

    if (!proactiveTimerRef.current) {
      proactiveTimerRef.current = createProactiveTimerController({
        intervalMs: PROACTIVE_LOOP_TICK_MS,
        task: () => checkInitiativeRef.current(),
      });
    }
    proactiveTimerRef.current.update({
      intervalMs: PROACTIVE_LOOP_TICK_MS,
      task: () => checkInitiativeRef.current(),
    });
    proactiveTimerRef.current.start();
    void checkInitiativeRef.current();
    return () => proactiveTimerRef.current?.stop();
  }, [
    settings.proactiveEnabled,
    settings.proactiveAdviceIntervalMinutes,
    settings.proactiveSmalltalkIntervalMinutes,
    proactiveWasEnabledRef,
    lastProactiveIntervalRef,
    checkInitiativeRef,
    clockRef,
  ]);

  useEffect(() => {
    const runPrune = () => {
      const ignored = pruneExpiredPendingInitiatives(
        settings.adaptiveInitiativeEnabled,
      );
      if (ignored > 0) {
        window.dispatchEvent(
          new CustomEvent(ADVICE_IGNORED_EVENT, {
            detail: { count: ignored },
          }),
        );
      }
    };
    runPrune();
    const timer = window.setInterval(runPrune, PROACTIVE_PRUNE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [settings.adaptiveInitiativeEnabled]);

  useEffect(() => {
    if (!settings.autoVisionEnabled || !settings.activityTrackingEnabled) {
      return;
    }

    let timer: number;
    const schedule = () => {
      const delay = randomJitterMs(
        randomRef.current,
        AUTO_VISION_MIN_DELAY_MS,
        AUTO_VISION_JITTER_MS,
      );
      timer = window.setTimeout(() => {
        void runAutoVisionGlanceRef.current().finally(schedule);
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
        void prepareProactivePackageRef.current(req.kind, {
          ...proactiveBundleOptionsRef.current(),
          eventHint: req.eventHint,
          ...req.options,
        }).then((pkg) => {
          if (!pkg) {
            return;
          }
          void launchProactiveInitiativeRef.current(pkg, {
            ignoreKindDailyCap: req.lab,
          }).then((result) => {
            if (result.sent && req.scenario) {
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

  return {
    recordUserAcknowledgedInitiative,
  };
}
