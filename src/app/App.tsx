import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import "./styles.css";
import { Avatar } from "./Avatar";
import { ChatPanel } from "./ChatPanel";
import { NotificationToast } from "./NotificationToast";
import { AriTaskBoard } from "./AriTaskBoard";
import { OnboardingPanel } from "./OnboardingPanel";
import {
  hideMainWindow,
  restoreWindowLayout,
  startWindowDragging,
  startWindowResize,
} from "./windowPosition";
import { playUiSound } from "../character/soundDesign";
import {
  detectBuildScenario,
  getScenarioPackOverlay,
  isCodingProcess,
  markScenarioTriggered,
  resolveScenario,
  type Scenario,
} from "../character/scenarioEngine";
import {
  deriveLifecycleState,
  lifecycleOpacity,
  type LifecycleState,
} from "../character/lifecycle";
import { PngCharacterRenderer, type SpriteSet } from "../character/characterRenderer";
import { isFocusSessionActive, getActiveFocusSession } from "../character/focusSession";
import { recordEmotion } from "../character/emotionHistory";
import { isQuietModeActive } from "../character/quietMode";
import { checkOllamaStatus } from "../llm/localLlmClient";
import { checkGigaChatStatus } from "../llm/gigaChatClient";
import { refreshGigaChatAuthCache } from "../llm/gigaChatStatus";
import { getUserIdleSeconds } from "../platform/userIdle";
import {
  CHAT_TYPING_IDLE_SECONDS,
  getCompanionSilenceMs,
  getEffectiveIdleSeconds,
  isChatInputFocused,
  recordCompanionInteraction,
} from "../platform/userActivity";
import {
  loadPomodoroState,
  tickPomodoro,
  type PomodoroState,
} from "../character/pomodoro";
import { getActiveWindowContext, type ActiveWindowInfo } from "../platform/activeWindow";
import { loadSettings, saveSettings } from "../settings/appSettings";
import type { CharacterEmotion, CharacterState } from "../types/character";
import {
  applyEmotionToMood,
  applyInteractionToMood,
  decayMood,
  loadMood,
  saveMood,
  moodAmbientReactionChance,
  moodPreferredEmotion,
  type CharacterMood,
} from "../character/mood";
import { deriveAttentionState, type AttentionState } from "../character/attention";
import {
  chooseMicroReaction,
  derivePresenceScene,
  settlingEmotion,
  type MicroReaction,
} from "../character/presence";
import {
  emotionSettleDelay,
  emotionTransitionPath,
  EMOTION_BRIDGE_MS,
} from "../character/emotionTransitions";
import {
  fuseRelationshipMoodEmotion,
  softenEmotionForMood,
} from "../character/emotionPresentation";
import { deriveRelationshipTone } from "../character/relationshipTone";
import {
  applyHeadpatToRelationship,
  loadRelationship,
} from "../character/relationship";
import { getRecentIgnoredInitiativeCount } from "../character/initiativeScoring";
import {
  ambientEmotionDurationMs,
  buildPcMicroReaction,
  buildSilentMicroReaction,
  reactionEmotion,
} from "../character/reactionRouter";
import {
  consumePcReaction,
  detectNonBuildPcError,
  mapBuildScenario,
  resolvePcReaction,
  type PcEventKind,
  type PcReactionPlan,
} from "../character/pcReactionCatalog";
import {
  enqueueProactiveRequest,
  subscribeProactiveRequests,
} from "../character/proactiveBridge";
import { REACTION_OVERLAY_MS } from "../character/reactionTiming";
import type { SilentReactionKind } from "../character/silentReactions";
import {
  blipVoiceManager,
  VOICE_CHANGED_EVENT,
} from "../character/blipVoiceManager";
import { pickIdleAction, type IdleActionId } from "./idleActions";
import { PROXIMITY_COOLDOWN_MS, ARI_USER_TYPING_EVENT } from "./avatarMotion";
import { checkForAppUpdates } from "../platform/appUpdater";

const INITIATIVE_EMOTION_COOLDOWN_MS = 15_000;
const MODEL_EMOTION_COOLDOWN_MS = 4_000;
const TYPING_PERK_COOLDOWN_MS = 4500;

function pickProximityReaction(
  mood: CharacterMood,
  scene: ReturnType<typeof derivePresenceScene>,
  hour: number,
): { emotion: CharacterEmotion; type: MicroReaction["type"] } {
  if (scene === "evening" || scene === "night" || hour >= 19 || hour < 6) {
    return { emotion: "empathetic", type: "heart" };
  }
  if (mood.energy > 0.55) {
    return { emotion: "happy", type: "sparkles" };
  }
  return { emotion: "curious", type: "question" };
}

export function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [chatOpen, setChatOpen] = useState(false);
  const [emotion, setEmotion] = useState<CharacterEmotion>("neutral");
  const [ambientEmotion, setAmbientEmotion] = useState<CharacterEmotion | null>(
    null,
  );
  const [characterState, setCharacterState] = useState<CharacterState>("idle");
  const [mood, setMood] = useState<CharacterMood>(loadMood);
  const [microReaction, setMicroReaction] = useState<MicroReaction | null>(null);
  const [ambientBubble, setAmbientBubble] = useState<string | null>(null);
  const [idleAction, setIdleAction] = useState<IdleActionId | null>(null);
  const [windowDragging, setWindowDragging] = useState(false);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [lastActiveWindow, setLastActiveWindow] =
    useState<ActiveWindowInfo | null>(null);
  const [userIdleSeconds, setUserIdleSeconds] = useState(0);
  const [pomodoro, setPomodoro] = useState<PomodoroState>(loadPomodoroState);

  const rendererRef = useRef(new PngCharacterRenderer());
  const [spriteSet, setSpriteSet] = useState<SpriteSet>(
    rendererRef.current.getSpriteSet(),
  );

  const presenceContextRef = useRef<{
    chatOpen: boolean;
    characterState: CharacterState;
    userIdleSeconds: number;
    scene: ReturnType<typeof derivePresenceScene>;
    mood: CharacterMood;
    attention: AttentionState;
    activeWindow: ActiveWindowInfo | null;
    quietModeActive: boolean;
    avatarLivelinessEnabled: boolean;
  } | null>(null);

  const chatOpenRef = useRef(chatOpen);
  const sceneRef = useRef<ReturnType<typeof derivePresenceScene>>("morning");
  const emotionRef = useRef(emotion);
  const moodRef = useRef(mood);
  const idlePeakRef = useRef(0);
  const returnHandledAtRef = useRef(0);
  const wasChatTypingAwayRef = useRef(false);
  const deepWorkSinceRef = useRef<number | null>(null);
  const clickBurstRef = useRef(0);
  const lastClickAtRef = useRef(0);
  const lastProximityAtRef = useRef(0);
  const lastTypingPerkAtRef = useRef(0);
  const lastBaseEmotionChangeAtRef = useRef(0);
  const ambientTimerRef = useRef<number | null>(null);
  const microReactionTimerRef = useRef<number | null>(null);
  const emotionSettleTimerRef = useRef<number | null>(null);
  const emotionTransitionTimerRef = useRef<number | null>(null);
  const showMicroReactionRef = useRef<
    (reaction: MicroReaction, reason?: Parameters<typeof recordEmotion>[1]) => void
  >(() => {});

  useEffect(() => {
    const applyViewportHeight = () => {
      document.documentElement.style.setProperty(
        "--viewport-height",
        `${window.innerHeight}px`,
      );
    };
    applyViewportHeight();
    window.addEventListener("resize", applyViewportHeight);
    return () => window.removeEventListener("resize", applyViewportHeight);
  }, []);

  const attention = deriveAttentionState({
    chatOpen,
    characterState,
    idleSeconds: userIdleSeconds,
    mood,
  });
  const scene = derivePresenceScene({
    attention,
    activeWindow: lastActiveWindow,
    idleSeconds: userIdleSeconds,
  });
  sceneRef.current = scene;
  const quietModeActive = isQuietModeActive(settings, lastActiveWindow);
  const lifecycle: LifecycleState = deriveLifecycleState(
    userIdleSeconds,
    new Date().getHours(),
    settings.quietMode,
    quietModeActive,
  );
  const avatarState: CharacterState =
    characterState === "speaking" && !voiceSpeaking
      ? chatOpen
        ? "listening"
        : "idle"
      : characterState;

  emotionRef.current = emotion;
  moodRef.current = mood;

  presenceContextRef.current = {
    chatOpen,
    characterState,
    userIdleSeconds,
    scene,
    mood,
    attention,
    activeWindow: lastActiveWindow,
    quietModeActive,
    avatarLivelinessEnabled: settings.avatarLivelinessEnabled,
  };

  const handleEmotionChange = useCallback((
    nextEmotion: CharacterEmotion,
    reason: "model" | "initiative" = "model",
  ) => {
    const current = emotionRef.current;
    let softened = softenEmotionForMood(
      nextEmotion,
      current,
      moodRef.current,
    );
    softened = fuseRelationshipMoodEmotion(
      softened,
      moodRef.current,
      deriveRelationshipTone(loadRelationship(), moodRef.current),
    );
    if (softened === current) {
      return;
    }

    const elapsed = Date.now() - lastBaseEmotionChangeAtRef.current;
    if (reason !== "model") {
      if (elapsed < INITIATIVE_EMOTION_COOLDOWN_MS) {
        return;
      }
    } else if (elapsed < MODEL_EMOTION_COOLDOWN_MS && softened === "neutral") {
      return;
    }

    lastBaseEmotionChangeAtRef.current = Date.now();
    if (emotionSettleTimerRef.current) {
      window.clearTimeout(emotionSettleTimerRef.current);
    }
    setAmbientEmotion(null);
    if (emotionTransitionTimerRef.current) {
      window.clearTimeout(emotionTransitionTimerRef.current);
    }

    if (reason === "model" || reason === "initiative") {
      setEmotion(softened);
    } else if (softened === "neutral") {
      setEmotion("neutral");
    } else {
      const path = emotionTransitionPath(current, softened);
      setEmotion(path[0]);
      if (path.length > 1 && path[1] !== path[0]) {
        emotionTransitionTimerRef.current = window.setTimeout(() => {
          setEmotion(path[1]!);
        }, EMOTION_BRIDGE_MS);
      }
    }

    setMood((currentMood) => applyEmotionToMood(currentMood, softened));
    recordEmotion(softened, reason);
  }, []);

  const handleProactiveMessage = useCallback(() => {
    recordCompanionInteraction();
    setChatOpen(true);
  }, []);
  const handleCollapseChat = useCallback(() => setChatOpen(false), []);
  const handleAmbientBubble = useCallback(
    (text: string | null) => setAmbientBubble(text),
    [],
  );
  const lastProactiveMicroAtRef = useRef(0);
  const handleProactiveEmitted = useCallback(
    (emotion: CharacterEmotion) => {
      if (!settings.avatarLivelinessEnabled || chatOpen) {
        return;
      }
      const now = Date.now();
      if (now - lastProactiveMicroAtRef.current < 15_000) {
        return;
      }
      lastProactiveMicroAtRef.current = now;
      showMicroReactionRef.current?.({
        id: now,
        type: "thinking",
        emotion,
        durationMs: 2800,
      });
    },
    [settings.avatarLivelinessEnabled, chatOpen],
  );

  function showMicroReaction(
    reaction: MicroReaction,
    _emotionReason: Parameters<typeof recordEmotion>[1] = "idle",
  ): void {
    if (!settings.avatarLivelinessEnabled) {
      return;
    }
    setMicroReaction(reaction);
    const nextEmotion = reactionEmotion(reaction);
    setAmbientEmotion(nextEmotion);
    playUiSound("reaction-overlay", settings.soundsEnabled, sceneRef.current === "night", {
      bodyDoubling: getActiveFocusSession()?.bodyDoubling,
      focusActive: pomodoro.phase === "focus",
      reactionEmotion: nextEmotion,
    });
    const durationMs = reaction.durationMs ?? REACTION_OVERLAY_MS;
    if (microReactionTimerRef.current) {
      window.clearTimeout(microReactionTimerRef.current);
    }
    if (ambientTimerRef.current) {
      window.clearTimeout(ambientTimerRef.current);
    }
    microReactionTimerRef.current = window.setTimeout(
      () => setMicroReaction(null),
      durationMs,
    );
    ambientTimerRef.current = window.setTimeout(
      () => setAmbientEmotion(null),
      ambientEmotionDurationMs(reaction),
    );
  }
  showMicroReactionRef.current = showMicroReaction;

  function triggerSilentReaction(
    kind: SilentReactionKind,
    preferredEmotion?: CharacterEmotion,
  ): boolean {
    const reaction = buildSilentMicroReaction(kind, sceneRef.current);
    if (!reaction) return false;
    const enriched =
      preferredEmotion && preferredEmotion !== "neutral"
        ? { ...reaction, emotion: preferredEmotion }
        : reaction;
    showMicroReaction(
      enriched,
      kind === "repeated_click" ? "click" : "idle",
    );
    return true;
  }

  function triggerPcPlanVisual(plan: PcReactionPlan): boolean {
    if (plan.silentReaction) {
      return triggerSilentReaction(plan.silentReaction);
    }
    showMicroReaction(buildPcMicroReaction(plan));
    return true;
  }

  function emitPcSpokenHint(plan: PcReactionPlan): void {
    if (!plan.spokenHint) {
      return;
    }
    enqueueProactiveRequest({
      kind: plan.initiativeKind ?? "context_comment",
      eventHint: plan.spokenHint,
    });
  }

  function runPcReaction(kind: PcEventKind): boolean {
    const plan = consumePcReaction(kind, { chatOpen });
    if (!plan) {
      return false;
    }
    triggerPcPlanVisual(plan);
    emitPcSpokenHint(plan);
    return true;
  }

  function runScenarioSilent(scenario: Scenario): boolean {
    const outcome = resolveScenario(scenario, {
      scenario,
      scene: sceneRef.current,
      hour: new Date().getHours(),
      idleSeconds: userIdleSeconds,
      chatOpen,
      characterState,
      focusSessionActive: isFocusSessionActive(),
    });
    if (outcome.kind === "silent") {
      const pack = getScenarioPackOverlay(scenario, {
        scenario,
        scene: sceneRef.current,
        hour: new Date().getHours(),
        idleSeconds: userIdleSeconds,
        chatOpen,
        characterState,
        focusSessionActive: isFocusSessionActive(),
      });
      if (pack) {
        showMicroReaction({
          id: Date.now(),
          type: (pack.overlay as MicroReaction["type"]) ?? "thinking",
          emotion: pack.emotion,
          thought: pack.line,
          durationMs: 4200,
        });
        markScenarioTriggered(scenario);
        return true;
      }
      const shown = triggerSilentReaction(outcome.reaction, outcome.emotion);
      if (shown) {
        markScenarioTriggered(scenario);
      }
      return shown;
    }
    if (outcome.kind === "initiative") {
      enqueueProactiveRequest({
        kind: outcome.initiativeKind,
        eventHint: outcome.description,
        scenario,
      });
      return true;
    }
    return false;
  }

  function handleAvatarClick() {
    recordCompanionInteraction();
    const now = Date.now();
    if (now - lastClickAtRef.current < 900) {
      clickBurstRef.current += 1;
    } else {
      clickBurstRef.current = 1;
    }
    lastClickAtRef.current = now;

    if (clickBurstRef.current >= 4) {
      clickBurstRef.current = 0;
      triggerSilentReaction("repeated_click");
    }

    setMood((current) => applyInteractionToMood(current, "click"));

    setChatOpen((wasOpen) => {
      const nextOpen = !wasOpen;
      if (nextOpen) {
        playUiSound(
          "chat-open",
          settings.soundsEnabled,
          sceneRef.current === "night",
        );
      } else {
        playUiSound(
          "chat-close",
          settings.soundsEnabled,
          sceneRef.current === "night",
        );
      }
      return nextOpen;
    });
  }

  function handleAvatarProximity() {
    if (!settings.avatarLivelinessEnabled) return;
    if (Date.now() - lastProximityAtRef.current < PROXIMITY_COOLDOWN_MS) return;
    if (chatOpen || characterState !== "idle") return;
    lastProximityAtRef.current = Date.now();
    const hour = new Date().getHours();
    const pick = pickProximityReaction(mood, scene, hour);
    handleEmotionChange(pick.emotion, "initiative");
    showMicroReaction({
      id: Date.now(),
      type: pick.type,
      emotion: pick.emotion,
      durationMs: 1600,
    });
  }

  function handleHeadpat() {
    setMood((current) => applyInteractionToMood(current, "headpat"));
    applyHeadpatToRelationship(loadRelationship());
    handleEmotionChange("blush", "initiative");
    showMicroReaction({
      id: Date.now(),
      type: "heart",
      emotion: "blush",
      thought: "…",
      durationMs: 2400,
    });
  }

  function handleAvatarQuickAction(action: "focus" | "hide" | "news") {
    if (action === "hide") {
      void hideMainWindow();
      return;
    }
    if (action === "focus") {
      setChatOpen(true);
      window.dispatchEvent(new CustomEvent("ari-focus-prompt"));
      return;
    }
    enqueueProactiveRequest({
      kind: "check_in",
      eventHint:
        "Пользователь спросил «что нового» через меню аватара. Коротко расскажи о незавершённых линиях или текущем фокусе, если есть повод.",
    });
    setChatOpen(true);
  }

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void restoreWindowLayout().then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!settings.autoUpdateEnabled) return;
    void checkForAppUpdates();
  }, [settings.autoUpdateEnabled]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (!chatOpen) {
      wasChatTypingAwayRef.current = false;
    }
  }, [chatOpen]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<PomodoroState>).detail;
      setPomodoro(detail ?? loadPomodoroState());
    };
    window.addEventListener("ari-pomodoro-changed", onChanged);
    return () => window.removeEventListener("ari-pomodoro-changed", onChanged);
  }, []);

  useEffect(() => {
    const update = () => setVoiceSpeaking(blipVoiceManager.isSpeaking());
    window.addEventListener(VOICE_CHANGED_EVENT, update);
    update();
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, update);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMood((current) => saveMood(decayMood(current)));
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      settings.quietMode !== "until" ||
      !settings.quietModeUntil ||
      settings.quietModeUntil > Date.now()
    ) {
      return;
    }
    setSettings((current) => ({
      ...current,
      quietMode: "off",
      quietModeUntil: undefined,
    }));
  }, [settings.quietMode, settings.quietModeUntil]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (settings.llmProvider === "gigachat") {
        await refreshGigaChatAuthCache();
      }
      const status =
        settings.llmProvider === "gigachat"
          ? await checkGigaChatStatus(settings)
          : await checkOllamaStatus(settings.ollamaBaseUrl);
      if (!cancelled) {
        setOllamaOnline(status.online);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [settings.llmProvider, settings.ollamaBaseUrl, settings.gigaChatModel]);

  useEffect(() => {
    if (!settings.activityTrackingEnabled) {
      setLastActiveWindow(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const windowInfo = await getActiveWindowContext(settings);
      if (cancelled) return;
      setLastActiveWindow(windowInfo);
      if (windowInfo) {
        const buildScenario = detectBuildScenario(windowInfo.title);
        const candidates: PcEventKind[] = [];
        if (buildScenario) {
          candidates.push(mapBuildScenario(buildScenario));
        }
        const errorKind = detectNonBuildPcError(
          windowInfo.processName,
          windowInfo.title,
        );
        if (errorKind) {
          candidates.push(errorKind);
        }
        const plan = resolvePcReaction(candidates, { chatOpen });
        if (plan) {
          triggerPcPlanVisual(plan);
          emitPcSpokenHint(plan);
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [settings, chatOpen]);

  useEffect(() => {
    let cancelled = false;
    const pollIdle = async () => {
      const systemIdle = await getUserIdleSeconds().catch(() => 0);
      const effectiveIdle = getEffectiveIdleSeconds(
        systemIdle,
        chatOpenRef.current,
      );
      if (cancelled) return;
      setUserIdleSeconds(effectiveIdle);

      if (effectiveIdle > idlePeakRef.current) {
        idlePeakRef.current = effectiveIdle;
      }

      if (
        chatOpenRef.current &&
        isChatInputFocused() &&
        effectiveIdle >= CHAT_TYPING_IDLE_SECONDS &&
        !wasChatTypingAwayRef.current
      ) {
        wasChatTypingAwayRef.current = true;
        runScenarioSilent("long_silence");
      }

      if (
        chatOpenRef.current &&
        wasChatTypingAwayRef.current &&
        effectiveIdle < 10
      ) {
        wasChatTypingAwayRef.current = false;
        returnHandledAtRef.current = Date.now();
        setMood((current) => applyInteractionToMood(current, "return"));
        if (!runPcReaction("return_from_idle")) {
          if (!triggerSilentReaction("return")) {
            runScenarioSilent("chat_return");
          }
        }
      }

      const absentMinutes = Math.round(idlePeakRef.current / 60);
      if (
        effectiveIdle < 30 &&
        idlePeakRef.current > 8 * 60 &&
        Date.now() - returnHandledAtRef.current > 60_000
      ) {
        returnHandledAtRef.current = Date.now();
        idlePeakRef.current = effectiveIdle;
        setMood((current) => applyInteractionToMood(current, "return"));
        if (!runPcReaction("return_from_idle")) {
          if (!triggerSilentReaction("return")) {
            const outcome = resolveScenario("return_after_absence", {
              scenario: "return_after_absence",
              scene: sceneRef.current,
              hour: new Date().getHours(),
              idleSeconds: userIdleSeconds,
              chatOpen,
              characterState,
              absentMinutes,
              focusSessionActive: isFocusSessionActive(),
            });
            if (outcome.kind === "initiative") {
              enqueueProactiveRequest({
                kind: outcome.initiativeKind,
                eventHint: outcome.description,
                scenario: "return_after_absence",
              });
            } else if (outcome.kind === "silent") {
              triggerSilentReaction(outcome.reaction);
            }
          }
        }
      }
    };
    void pollIdle();
    const timer = window.setInterval(() => void pollIdle(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [chatOpen, characterState, userIdleSeconds]);

  useEffect(() => {
    if (!settings.pomodoroEnabled) return;

    const handleTick = () => {
      const result = tickPomodoro();
      setPomodoro(loadPomodoroState());

      if (quietModeActive || characterState !== "idle") {
        return;
      }

      if (result.kind === "support_moment") {
        showMicroReaction({
          id: Date.now(),
          type: "thinking",
          emotion: result.emotion,
          thought: result.line,
          durationMs: 4200,
        });
        void blipVoiceManager.speak(result.line, {
          settings,
          emotion: result.emotion,
          pomodoro: true,
          activeWindow: lastActiveWindow,
          onSpeakingStart: () => setCharacterState("speaking"),
          onSpeakingEnd: () => setCharacterState("idle"),
        });
        return;
      }

      if (result.kind === "phase_ended") {
        const thought =
          result.nextPhase === "break"
            ? "Перерыв. Можно выдохнуть — я не тороплю."
            : "Снова фокус. Я рядом, но не мешаю.";
        const phaseEmotion = result.nextPhase === "break" ? "happy" : "calm";
        setMicroReaction({
          id: Date.now(),
          type: "thinking",
          emotion: phaseEmotion,
          thought,
          durationMs: 5000,
        });
        setAmbientEmotion(phaseEmotion);
        if (microReactionTimerRef.current) {
          window.clearTimeout(microReactionTimerRef.current);
        }
        microReactionTimerRef.current = window.setTimeout(
          () => setMicroReaction(null),
          5000,
        );
        void blipVoiceManager.speak(thought, {
          settings,
          emotion: phaseEmotion,
          pomodoro: true,
          activeWindow: lastActiveWindow,
          onSpeakingStart: () => setCharacterState("speaking"),
          onSpeakingEnd: () => setCharacterState("idle"),
        });
      }
    };

    const timer = window.setInterval(handleTick, 1_000);
    return () => window.clearInterval(timer);
  }, [
    settings,
    quietModeActive,
    characterState,
    pomodoro.phase,
    lastActiveWindow,
  ]);

  useEffect(() => {
    rendererRef.current.setScene(scene);
    rendererRef.current.setLifecycle(lifecycle);
    const focusActive = isFocusSessionActive();
    const nextSpriteSet: SpriteSet = focusActive
      ? "focus"
      : scene === "night"
        ? "night"
        : "default";
    rendererRef.current.setSpriteSet(nextSpriteSet);
    rendererRef.current.setEmotion(ambientEmotion ?? emotion);
    rendererRef.current.setState(avatarState);
    setSpriteSet(rendererRef.current.getSpriteSet());
  }, [scene, lifecycle, ambientEmotion, emotion, avatarState, pomodoro.phase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!chatOpen && characterState === "idle") {
        runScenarioSilent("app_start");
      }
    }, 2200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return subscribeProactiveRequests(() => {
      if (getRecentIgnoredInitiativeCount() >= 2) {
        runScenarioSilent("ignored_initiative");
      }
    });
  }, []);

  useEffect(() => {
    const hour = new Date().getHours();
    if (
      (scene === "night" || hour >= 23 || hour < 5) &&
      !chatOpen &&
      characterState === "idle" &&
      userIdleSeconds < 120
    ) {
      const outcome = resolveScenario("late_night_work", {
        scenario: "late_night_work",
        scene,
        hour,
        idleSeconds: userIdleSeconds,
        chatOpen,
        characterState,
        focusSessionActive: isFocusSessionActive(),
      });
      if (outcome.kind === "initiative") {
        enqueueProactiveRequest({
          kind: outcome.initiativeKind,
          eventHint: outcome.description,
          scenario: "late_night_work",
        });
      }
    }
  }, [scene, chatOpen, characterState, userIdleSeconds]);

  useEffect(() => {
    const coding =
      lastActiveWindow && isCodingProcess(lastActiveWindow.processName);
    if (scene === "focus" && coding) {
      if (!deepWorkSinceRef.current) {
        deepWorkSinceRef.current = Date.now();
      } else if (
        Date.now() - deepWorkSinceRef.current > 35 * 60_000 &&
        !chatOpen
      ) {
        runScenarioSilent("deep_work_detected");
        deepWorkSinceRef.current = Date.now();
      }
    } else {
      deepWorkSinceRef.current = null;
    }
  }, [scene, lastActiveWindow, chatOpen]);

  useEffect(() => {
    if (!ambientBubble) return;
    const timer = window.setTimeout(() => setAmbientBubble(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [ambientBubble]);

  useEffect(() => {
    if (characterState !== "idle") {
      return;
    }
    emotionSettleTimerRef.current = window.setTimeout(() => {
      const next = settlingEmotion(
        emotionRef.current,
        moodRef.current,
        sceneRef.current,
      );
      if (next !== emotionRef.current) {
        setEmotion(next);
        recordEmotion(next, "scene");
      }
    }, emotionSettleDelay(emotion));
    return () => {
      if (emotionSettleTimerRef.current) {
        window.clearTimeout(emotionSettleTimerRef.current);
      }
    };
  }, [emotion, characterState]);

  useEffect(() => {
    let timer: number;

    const schedule = () => {
      const context = presenceContextRef.current;
      const observing = context?.attention === "observing";
      const delay =
        (observing ? 28_000 : 48_000) + Math.random() * (observing ? 40_000 : 70_000);
      timer = window.setTimeout(() => {
        const context = presenceContextRef.current;
        if (!context) {
          schedule();
          return;
        }
        const companionQuiet = getCompanionSilenceMs() >= 10 * 60_000;
        const canReact =
          context.avatarLivelinessEnabled &&
          !context.chatOpen &&
          context.characterState === "idle" &&
          (context.userIdleSeconds < 3 * 60 || companionQuiet);
        const reactionBase = context.attention === "observing" ? 0.84 : 0.58;
        if (canReact && Math.random() < moodAmbientReactionChance(context.mood, reactionBase)) {
          const localKind =
            context.activeWindow &&
            isCodingProcess(context.activeWindow.processName)
              ? "coding_context"
              : "ambient";
          if (companionQuiet && Math.random() < 0.25) {
            runScenarioSilent("long_silence");
          }
          const preferredEmotion = moodPreferredEmotion(context.mood);
          const reaction =
            buildSilentMicroReaction(localKind, context.scene) ??
            chooseMicroReaction({
              scene: context.scene,
              mood: context.mood,
              activeWindow: context.activeWindow,
            });
          if (reaction) {
            if (preferredEmotion) {
              reaction.emotion = preferredEmotion;
            }
            showMicroReactionRef.current(reaction, "idle");
          }
        }
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      window.clearTimeout(timer);
      if (ambientTimerRef.current) {
        window.clearTimeout(ambientTimerRef.current);
      }
      if (microReactionTimerRef.current) {
        window.clearTimeout(microReactionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let timer: number;

    const schedule = () => {
      const delay = 22_000 + Math.random() * 26_000;
      timer = window.setTimeout(() => {
        const context = presenceContextRef.current;
        if (
          context &&
          context.avatarLivelinessEnabled &&
          !context.chatOpen &&
          context.characterState === "idle" &&
          !context.quietModeActive &&
          context.userIdleSeconds < 3 * 60
        ) {
          const action = pickIdleAction(context.mood, context.attention);
          if (action) {
            setIdleAction(action);
            window.setTimeout(() => setIdleAction(null), 2800);
          }
        }
        schedule();
      }, delay);
    };

    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onTyping = () => {
      if (!chatOpenRef.current) return;
      if (characterState !== "listening" && characterState !== "idle") return;
      const now = Date.now();
      if (now - lastTypingPerkAtRef.current < TYPING_PERK_COOLDOWN_MS) return;
      lastTypingPerkAtRef.current = now;
      if (characterState === "idle") {
        handleEmotionChange("curious", "initiative");
      }
    };
    window.addEventListener(ARI_USER_TYPING_EVENT, onTyping);
    return () => window.removeEventListener(ARI_USER_TYPING_EVENT, onTyping);
  }, [characterState, handleEmotionChange]);

  return (
    <main
      className="desktop-character"
      data-scene={scene}
      data-sprite-set={spriteSet}
      data-emotion={ambientEmotion ?? emotion}
      data-quiet={quietModeActive}
      data-lifecycle={lifecycle}
      data-chat-open={chatOpen}
      style={{ "--lifecycle-opacity": lifecycleOpacity(lifecycle) } as CSSProperties}
    >
      <button
        className="window-drag-handle"
        type="button"
        aria-label="Перетащить окно Ari"
        title="Перетащить"
        onPointerDown={() => {
          setWindowDragging(true);
          showMicroReaction({
            id: Date.now(),
            type: "surprise",
            emotion: "surprised",
            durationMs: 1800,
          });
          void startWindowDragging().finally(() => {
            window.setTimeout(() => setWindowDragging(false), 320);
          });
        }}
      >
        ⋮⋮⋮
      </button>
      <button
        className="window-hide-button"
        type="button"
        onClick={() => void hideMainWindow()}
        aria-label="Скрыть Ari в системный трей"
        title="Скрыть в трей"
      >
        —
      </button>
      <button
        className="window-resize-handle"
        type="button"
        aria-label="Изменить размер окна"
        title="Потяните, чтобы изменить размер"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          void startWindowResize("SouthWest");
        }}
      >
        ◢
      </button>
      <ChatPanel
        isOpen={chatOpen}
        settings={settings}
        onSettingsChange={setSettings}
        onEmotionChange={handleEmotionChange}
        onStateChange={setCharacterState}
        ollamaOnline={ollamaOnline}
        activeWindow={lastActiveWindow}
        onProactiveMessage={handleProactiveMessage}
        onCollapseChat={handleCollapseChat}
        mood={mood}
        emotion={ambientEmotion ?? emotion}
        attention={attention}
        scene={scene}
        lifecycle={lifecycle}
        userIdleSeconds={userIdleSeconds}
        pomodoro={pomodoro}
        characterState={characterState}
        onAmbientBubble={handleAmbientBubble}
        onProactiveEmitted={handleProactiveEmitted}
        onMoodInteraction={(interaction) =>
          setMood((current) => applyInteractionToMood(current, interaction))
        }
      />
      <NotificationToast />
      <AriTaskBoard
        chatOpen={chatOpen}
        onSpeakAbout={(text) => setAmbientBubble(text.slice(0, 220))}
      />
      {ambientBubble && !chatOpen && (
        <div className="ari-ambient-bubble" role="status" aria-live="polite">
          <span className="ari-ambient-bubble-text">{ambientBubble}</span>
        </div>
      )}
      <Avatar
        chatOpen={chatOpen}
        emotion={ambientEmotion ?? emotion}
        state={avatarState}
        mood={mood}
        attention={attention}
        scene={scene}
        lifecycle={lifecycle}
        renderer={rendererRef.current}
        microReaction={microReaction}
        idleAction={idleAction}
        windowDragging={windowDragging}
        livelinessEnabled={settings.avatarLivelinessEnabled}
        onProximity={handleAvatarProximity}
        onHeadpat={handleHeadpat}
        onQuickAction={handleAvatarQuickAction}
        onClick={handleAvatarClick}
      />
      {!settings.onboardingCompleted && (
        <OnboardingPanel settings={settings} onChange={setSettings} />
      )}
    </main>
  );
}
