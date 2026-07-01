import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  CharacterEmotion,
  CharacterState,
} from "../types/character";
import type { CharacterMood } from "../character/mood";
import type { AttentionState } from "../character/attention";
import type {
  MicroReaction,
  MicroReactionType,
  PresenceScene,
} from "../character/presence";
import type { LifecycleState } from "../character/lifecycle";
import { overlayDurationMs } from "../character/reactionTiming";
import {
  AVATAR_REACTION_EVENT,
  PngCharacterRenderer,
  type CharacterRenderer,
} from "../character/characterRenderer";
import { useAvatarMotion, ARI_USER_TYPING_EVENT } from "./avatarMotion";
import { idleActionClass, type IdleActionId } from "./idleActions";

function formatThoughtText(thought: string): string {
  return thought.replace(/^\*+|\*+$/g, "").trim();
}

type AvatarQuickAction = "focus" | "hide" | "news";

type AvatarProps = {
  onClick: () => void;
  onHeadpat?: () => void;
  onQuickAction?: (action: AvatarQuickAction) => void;
  chatOpen: boolean;
  emotion: CharacterEmotion;
  state: CharacterState;
  mood: CharacterMood;
  attention: AttentionState;
  scene: PresenceScene;
  lifecycle: LifecycleState;
  renderer?: CharacterRenderer;
  microReaction: MicroReaction | null;
  idleAction?: IdleActionId | null;
  windowDragging?: boolean;
  livelinessEnabled?: boolean;
  onProximity?: () => void;
};

type ReactionOverlay = MicroReactionType;

const SQUISH_MS = 420;
const HEADPAT_LOCK_MS = 700;
const RECOIL_MS = 320;
const LONG_PRESS_MS = 620;
const HOVER_REACTION_MS = 650;
const BLINK_CLOSE_MS = 105;
const BLINK_MIN_MS = 5500;
const BLINK_RANDOM_MS = 6500;

const overlaySymbols: Record<ReactionOverlay, string> = {
  question: "?",
  surprise: "!",
  heart: "♥",
  anger: "╬",
  sparkles: "✦",
  thinking: "…",
};

function reactionFor(
  emotion: CharacterEmotion,
  state: CharacterState,
): ReactionOverlay | null {
  if (state === "thinking") return "thinking";
  if (emotion === "surprised" || emotion === "excited") return "surprise";
  if (emotion === "curious" || emotion === "pensive") return "question";
  if (emotion === "annoyed") return "anger";
  if (
    emotion === "blush" ||
    emotion === "empathetic" ||
    emotion === "shy" ||
    emotion === "worried" ||
    emotion === "sad"
  ) {
    return "heart";
  }
  if (
    emotion === "amused" ||
    emotion === "happy" ||
    emotion === "proud"
  ) {
    return "sparkles";
  }
  return null;
}

export function Avatar({
  onClick,
  onHeadpat,
  onQuickAction,
  chatOpen,
  emotion,
  state,
  mood,
  attention,
  scene,
  lifecycle,
  renderer,
  microReaction,
  idleAction = null,
  windowDragging = false,
  livelinessEnabled = true,
  onProximity,
}: AvatarProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const { motionVars, setPointerParallax, clearPointerParallax, nudgeGaze } =
    useAvatarMotion(shellRef, onProximity, livelinessEnabled);
  const pngRenderer = useMemo(
    () => renderer ?? new PngCharacterRenderer(),
    [renderer],
  );

  useEffect(() => {
    pngRenderer.setEmotion(emotion);
    pngRenderer.setState(state);
    pngRenderer.setScene(scene);
    pngRenderer.setLifecycle(lifecycle);
  }, [pngRenderer, emotion, state, scene, lifecycle]);

  const desiredPath = useMemo(
    () => pngRenderer.getAvatarPath(emotion, state, state === "speaking"),
    [pngRenderer, emotion, state],
  );

  const [layers, setLayers] = useState<[string, string]>([
    desiredPath,
    desiredPath,
  ]);
  const [activeLayer, setActiveLayer] = useState<0 | 1>(0);
  const [overlay, setOverlay] = useState<{
    id: number;
    type: ReactionOverlay;
    thought?: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const activeLayerRef = useRef<0 | 1>(0);
  const displayedPathRef = useRef(desiredPath);
  const initializedRef = useRef(false);
  const lastMicroReactionRef = useRef<number | null>(null);
  const [blinking, setBlinking] = useState(false);
  const [recoil, setRecoil] = useState(false);
  const [squish, setSquish] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const squishTimerRef = useRef<number | null>(null);
  const headpatTimerRef = useRef<number | null>(null);
  const recoilTimerRef = useRef<number | null>(null);
  const clickBurstRef = useRef(0);
  const lastClickAtRef = useRef(0);
  const longPressTimerRef = useRef<number | null>(null);
  const headpatTriggeredRef = useRef(false);

  useEffect(() => {
    return () => {
      for (const timer of [
        hoverTimerRef.current,
        squishTimerRef.current,
        headpatTimerRef.current,
        recoilTimerRef.current,
        longPressTimerRef.current,
      ]) {
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!chatOpen) return;
    const onTyping = () => {
      nudgeGaze(-7, -5);
    };
    window.addEventListener(ARI_USER_TYPING_EVENT, onTyping);
    return () => window.removeEventListener(ARI_USER_TYPING_EVENT, onTyping);
  }, [chatOpen, nudgeGaze]);

  useEffect(() => {
    const onReaction = () => {
      triggerSquish();
    };
    window.addEventListener(AVATAR_REACTION_EVENT, onReaction);
    return () => window.removeEventListener(AVATAR_REACTION_EVENT, onReaction);
  }, [pngRenderer]);

  useEffect(() => {
    activeLayerRef.current = activeLayer;
  }, [activeLayer]);

  useEffect(() => {
    if (displayedPathRef.current === desiredPath) return;

    const renderer = pngRenderer as PngCharacterRenderer;
    const applyPath = (path: string) => {
      const image = new Image();
      image.src = path;
      image.onload = () => {
        const nextLayer = activeLayerRef.current === 0 ? 1 : 0;
        displayedPathRef.current = path;
        setLayers((current) => {
          const next: [string, string] = [...current];
          next[nextLayer] = path;
          return next;
        });
        window.requestAnimationFrame(() => {
          activeLayerRef.current = nextLayer;
          setActiveLayer(nextLayer);
        });
      };
      image.onerror = () => {
        const fallback = renderer.getLegacyFallbackPath(emotion, state);
        if (fallback !== path) {
          applyPath(fallback);
        }
      };
    };

    applyPath(desiredPath);
  }, [desiredPath, pngRenderer, emotion, state]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    if (
      microReaction &&
      (lastMicroReactionRef.current === microReaction.id ||
        (microReaction.emotion === emotion && state === "idle"))
    ) {
      return;
    }
    const type = reactionFor(emotion, state);
    if (!type) return;
    const id = Date.now();
    setOverlay({ id, type });
    const timer = window.setTimeout(
      () => setOverlay((current) => (current?.id === id ? null : current)),
      overlayDurationMs(type),
    );
    return () => window.clearTimeout(timer);
  }, [emotion, state, microReaction]);

  useEffect(() => {
    if (!microReaction) return;
    const { id, type, thought } = microReaction;
    lastMicroReactionRef.current = id;
    setOverlay({ id, type, thought });
    const timer = window.setTimeout(
      () => setOverlay((current) => (current?.id === id ? null : current)),
      microReaction.durationMs ?? overlayDurationMs(type),
    );
    return () => window.clearTimeout(timer);
  }, [microReaction]);

  useEffect(() => {
    let blinkTimer = 0;
    let closeTimer = 0;
    const schedule = () => {
      blinkTimer = window.setTimeout(() => {
        if (state !== "speaking" && state !== "thinking") {
          setBlinking(true);
          closeTimer = window.setTimeout(() => setBlinking(false), BLINK_CLOSE_MS);
        }
        schedule();
      }, BLINK_MIN_MS + Math.random() * BLINK_RANDOM_MS);
    };
    schedule();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(closeTimer);
    };
  }, [state]);

  function triggerSquish() {
    if (squishTimerRef.current) {
      window.clearTimeout(squishTimerRef.current);
    }
    setSquish(true);
    squishTimerRef.current = window.setTimeout(() => {
      setSquish(false);
      squishTimerRef.current = null;
    }, SQUISH_MS);
    pngRenderer.playReaction({ kind: "repeated_click" });
  }

  function triggerHeadpat() {
    if (headpatTriggeredRef.current) return;
    headpatTriggeredRef.current = true;
    if (headpatTimerRef.current) {
      window.clearTimeout(headpatTimerRef.current);
    }
    headpatTimerRef.current = window.setTimeout(() => {
      headpatTriggeredRef.current = false;
      headpatTimerRef.current = null;
    }, HEADPAT_LOCK_MS);
    setOverlay({ id: Date.now(), type: "heart" });
    triggerSquish();
    onHeadpat?.();
  }

  function triggerRecoil() {
    if (recoilTimerRef.current) {
      window.clearTimeout(recoilTimerRef.current);
    }
    setRecoil(true);
    recoilTimerRef.current = window.setTimeout(() => {
      setRecoil(false);
      recoilTimerRef.current = null;
    }, RECOIL_MS);
  }

  const idleClass = livelinessEnabled ? idleActionClass(idleAction) : "";

  return (
    <div className="avatar-shell" ref={shellRef}>
      <button
        className={`avatar-button state-${state}${recoil ? " recoil" : ""}${
          squish ? " avatar-squish" : ""
        }${windowDragging ? " window-dragging" : ""}`}
        type="button"
        onClick={() => {
          const now = Date.now();
          if (now - lastClickAtRef.current < 320) {
            triggerHeadpat();
            lastClickAtRef.current = 0;
            return;
          }
          lastClickAtRef.current = now;
          clickBurstRef.current += 1;
          if (emotion === "annoyed" && clickBurstRef.current >= 2) {
            triggerRecoil();
            clickBurstRef.current = 0;
          }
          triggerSquish();
          onClick();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        onPointerDown={() => {
          if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
          }
          longPressTimerRef.current = window.setTimeout(() => {
            triggerHeadpat();
            longPressTimerRef.current = null;
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => {
          if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }}
        onPointerCancel={() => {
          if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }}
        aria-label={chatOpen ? "Закрыть чат с Ari" : "Открыть чат с Ari"}
        aria-expanded={chatOpen}
        data-emotion={emotion}
        data-mood-energy={
          mood.energy > 0.65 ? "high" : mood.energy < 0.25 ? "low" : "normal"
        }
        data-mood-warmth={
          mood.warmth > 0.55 ? "warm" : mood.warmth < 0.15 ? "cool" : "normal"
        }
        data-mood-irritated={mood.irritation > 0.45}
        data-attention={attention}
        data-scene={scene}
        data-lifecycle={lifecycle}
        style={
          livelinessEnabled
            ? ({
                "--parallax-x": `${motionVars.parallaxX}px`,
                "--parallax-y": `${motionVars.parallaxY}px`,
                "--gaze-x": `${motionVars.gazeX}px`,
                "--gaze-y": `${motionVars.gazeY}px`,
              } as CSSProperties)
            : undefined
        }
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPointerParallax(
            ((event.clientX - rect.left) / rect.width - 0.5) * 8,
            ((event.clientY - rect.top) / rect.height - 0.5) * 5,
          );
        }}
        onPointerEnter={() => {
          if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = window.setTimeout(() => {
            if (!overlay && state === "idle") {
              setOverlay({ id: Date.now(), type: "question" });
            }
            hoverTimerRef.current = null;
          }, HOVER_REACTION_MS);
        }}
        onPointerLeave={() => {
          clearPointerParallax();
          if (hoverTimerRef.current) {
            window.clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
          setOverlay((current) =>
            current?.type === "question" ? null : current,
          );
        }}
      >
        <span
          className={`avatar-stage${blinking ? " blinking" : ""}${
            idleClass ? ` ${idleClass}` : ""
          }`}
          aria-hidden="true"
        >
          {layers.map((path, index) => (
            <img
              className={`avatar-image${
                activeLayer === index ? " active" : ""
              }`}
              src={path}
              alt=""
              draggable={false}
              key={`${index}-${path}`}
              onError={(event) => {
                const renderer = pngRenderer as PngCharacterRenderer;
                event.currentTarget.src = renderer.getLegacyFallbackPath(
                  emotion,
                  state,
                );
              }}
            />
          ))}
        </span>
        {overlay && (
          <>
            <span
              className={`reaction-overlay reaction-${overlay.type}`}
              key={overlay.id}
              aria-hidden="true"
            >
              {overlaySymbols[overlay.type]}
            </span>
            {overlay.thought && (
              <span className="private-thought" aria-hidden="true">
                {formatThoughtText(overlay.thought)}
              </span>
            )}
          </>
        )}
        <span className="sr-only">{`Ari: ${emotion}`}</span>
      </button>

      {contextMenu && (
        <>
          <button
            type="button"
            className="avatar-menu-backdrop"
            aria-label="Закрыть меню"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="avatar-context-menu"
            role="menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onQuickAction?.("focus");
                setContextMenu(null);
              }}
            >
              Фокус
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onQuickAction?.("news");
                setContextMenu(null);
              }}
            >
              Что нового?
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onQuickAction?.("hide");
                setContextMenu(null);
              }}
            >
              Скрыть
            </button>
          </div>
        </>
      )}
    </div>
  );
}
