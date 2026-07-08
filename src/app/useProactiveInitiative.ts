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
import type { AdviceDecision } from "../character/adviceEngine";
import { ADVICE_IGNORED_EVENT } from "../character/adviceOutcome";
import {
  drainProactiveRequests,
  subscribeProactiveRequests,
} from "../character/proactiveBridge";
import {
  armProactiveGracePeriod,
  canEmitAdviceNow,
  canEmitSmalltalkNow,
  ensureProactiveClockStarted,
  getLastAdviceAttemptAt,
  getLastSmalltalkAttemptAt,
  getProactiveFailureBackoff,
  shouldSuppressOpenChatAdvice,
} from "../character/proactiveState";
import { planProactiveEngineTick } from "../character/proactiveEngine";
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

type InitiativeLaunchResult = { sent: boolean; suppressReason?: string };

const COMPANION_SESSION_MIN_MS = 15 * 60 * 1000;
const COMPANION_SILENCE_MIN_MS = 12 * 60 * 1000;

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
  } = input;
  const getProactiveTimingRef = useRef(getProactiveTiming);
  const proactiveBundleOptionsRef = useRef(proactiveBundleOptions);
  const prepareProactivePackageRef = useRef(prepareProactivePackage);
  const launchProactiveInitiativeRef = useRef(launchProactiveInitiative);
  const launchAdviceFromEngineRef = useRef(launchAdviceFromEngine);
  const tryGenericCompanionInitiativeRef = useRef(tryGenericCompanionInitiative);
  const runAutoVisionGlanceRef = useRef(runAutoVisionGlance);
  getProactiveTimingRef.current = getProactiveTiming;
  proactiveBundleOptionsRef.current = proactiveBundleOptions;
  prepareProactivePackageRef.current = prepareProactivePackage;
  launchProactiveInitiativeRef.current = launchProactiveInitiative;
  launchAdviceFromEngineRef.current = launchAdviceFromEngine;
  tryGenericCompanionInitiativeRef.current = tryGenericCompanionInitiative;
  runAutoVisionGlanceRef.current = runAutoVisionGlance;

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

  useEffect(() => {
    if (!settings.proactiveEnabled) {
      proactiveWasEnabledRef.current = false;
      return;
    }

    const adviceIntervalMs = proactiveAdviceIntervalMs(settings);
    const smalltalkIntervalMs = proactiveSmalltalkIntervalMs(settings);
    ensureProactiveClockStarted(adviceIntervalMs, smalltalkIntervalMs);
    if (!proactiveWasEnabledRef.current) {
      armProactiveGracePeriod(adviceIntervalMs, smalltalkIntervalMs);
      proactiveWasEnabledRef.current = true;
    }
    const intervalKey = `${settings.proactiveAdviceIntervalMinutes}:${settings.proactiveSmalltalkIntervalMinutes}`;
    if (lastProactiveIntervalRef.current !== intervalKey) {
      armProactiveGracePeriod(adviceIntervalMs, smalltalkIntervalMs);
      lastProactiveIntervalRef.current = intervalKey;
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
      if (getProactiveFailureBackoff()) {
        return;
      }
      const activityAgoMs = Math.max(
        Date.now() - lastUserActivityRef.current,
        userIdleSecondsRef.current * 1000,
      );
      const companionSilenceMs = getCompanionSilenceMs();
      const proactiveTiming = getProactiveTimingRef.current();
      const sessionMs = proactiveTiming.sessionMs;
      const immersedCompanion =
        companionSilenceMs >= COMPANION_SILENCE_MIN_MS &&
        sessionMs >= COMPANION_SESSION_MIN_MS &&
        Boolean(activeWindowRef.current) &&
        settings.activityTrackingEnabled;
      const llmOnline = isLlmProviderOnline(settings, ollamaOnline);
      const activeLevel = settings.initiativeLevel === "active";
      const adviceIdleMs = Math.min(2 * 60 * 1000, smalltalkIntervalMs);
      const smalltalkIdleMs =
        activeLevel && isOpen
          ? ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS
          : adviceIdleMs;
      const canEvaluateAdvice =
        immersedCompanion || activityAgoMs >= adviceIdleMs;
      const canEvaluateSmalltalk =
        immersedCompanion || activityAgoMs >= smalltalkIdleMs;
      const plannedSilenceMs = adviceIdleMs;
      const smalltalkPlannedSilenceMs =
        activeLevel && isOpen
          ? ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS
          : plannedSilenceMs;

      if (
        isLoadingRef.current ||
        (!canEvaluateSmalltalk && !canEvaluateAdvice)
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
        userIntervalMs: adviceIntervalMs,
      });
      setLastAdviceUrgency(urgency);

      const now = Date.now();
      const sinceAdviceAttempt = now - getLastAdviceAttemptAt();
      const sinceSmalltalkAttempt = now - getLastSmalltalkAttemptAt();
      const smalltalkReady =
        canEvaluateSmalltalk &&
        sinceSmalltalkAttempt >= smalltalkIntervalMs &&
        canEmitSmalltalkNow(settings, now);
      const adviceChannelReady =
        canEvaluateAdvice && canEmitAdviceNow(settings, now);
      const idleGateOpen = canEvaluateAdvice;
      const toneSnapshot = getProactiveToneSnapshot();
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
        return;
      }

      const allowSmalltalk = engineDecision.allowSmalltalk;

      if (tickAction === "try_advice") {
        if (!adviceChannelReady) {
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
          return;
        }
        const { runAdviceCycle } = await loadProactiveRuntime();
        const decision = await runAdviceCycle({
          settings,
          bundle: signalBundle,
          urgency: adviceUrgency,
          packageOptions: proactiveBundleOptionsRef.current({
            urgency: adviceUrgency,
          }),
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
        adviceStreak >= 2 ? 0.22 : adviceStreak >= 1 ? 0.12 : 0;
      const tryMemory =
        ritualPending ||
        longSilence ||
        (!activeLevel &&
          Math.random() <
            Math.min(0.72, idleLineProbability(settings) + memoryRollBoost));

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
        Math.random() <
          Math.min(
            0.35,
            0.1 + (adviceStreak >= 2 ? 0.18 : adviceStreak >= 1 ? 0.08 : 0),
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
    };

    const timer = window.setInterval(checkInitiative, 15_000);
    return () => window.clearInterval(timer);
  }, [
    settings,
    ollamaOnline,
    isOpen,
    activeWindowRef,
    historyRef,
    lifecycleRef,
    userIdleSecondsRef,
    lastUserActivityRef,
    lastVisionObservationRef,
    isLoadingRef,
    proactiveWasEnabledRef,
    lastProactiveIntervalRef,
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
    const timer = window.setInterval(runPrune, 60_000);
    return () => window.clearInterval(timer);
  }, [settings.adaptiveInitiativeEnabled]);

  useEffect(() => {
    if (!settings.autoVisionEnabled || !settings.activityTrackingEnabled) {
      return;
    }

    let timer: number;
    const schedule = () => {
      const delay = 8 * 60_000 + Math.random() * 12 * 60_000;
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
