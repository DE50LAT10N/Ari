import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const SPRING_STIFFNESS = 0.14;
const SPRING_DAMPING = 0.72;
const GAZE_MAX = 11;
const PROXIMITY_RADIUS = 260;
const PROXIMITY_INNER = 48;
export const PROXIMITY_COOLDOWN_MS = 18_000;
export const ARI_USER_TYPING_EVENT = "ari-user-typing";

export type AvatarMotionVars = {
  gazeX: number;
  gazeY: number;
  parallaxX: number;
  parallaxY: number;
};

function springStep(current: number, velocity: number, target: number) {
  const force = (target - current) * SPRING_STIFFNESS;
  const nextVel = (velocity + force) * SPRING_DAMPING;
  return { pos: current + nextVel, vel: nextVel };
}

export function useAvatarMotion(
  shellRef: RefObject<HTMLElement | null>,
  onProximity?: () => void,
  enabled = true,
) {
  const targetGaze = useRef({ x: 0, y: 0 });
  const targetParallax = useRef({ x: 0, y: 0 });
  const gaze = useRef({ x: 0, y: 0 });
  const parallax = useRef({ x: 0, y: 0 });
  const gazeVel = useRef({ x: 0, y: 0 });
  const parallaxVel = useRef({ x: 0, y: 0 });
  const lastMouse = useRef({ x: 0, y: 0, at: 0 });
  const lastProximityAt = useRef(0);
  const onProximityRef = useRef(onProximity);
  onProximityRef.current = onProximity;

  const [motionVars, setMotionVars] = useState<AvatarMotionVars>({
    gazeX: 0,
    gazeY: 0,
    parallaxX: 0,
    parallaxY: 0,
  });

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) {
      setMotionVars({
        gazeX: 0,
        gazeY: 0,
        parallaxX: 0,
        parallaxY: 0,
      });
    }
  }, [enabled]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!enabledRef.current) return;
      lastMouse.current = { x: event.clientX, y: event.clientY, at: Date.now() };
      const el = shellRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.54;
      const cy = rect.top + rect.height * 0.38;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const norm = Math.min(1, 130 / dist);
      targetGaze.current = {
        x: (dx / dist) * GAZE_MAX * norm,
        y: (dy / dist) * GAZE_MAX * norm * 0.62,
      };

      const avatarDist = Math.hypot(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height * 0.52),
      );
      if (
        avatarDist < PROXIMITY_RADIUS &&
        avatarDist > PROXIMITY_INNER &&
        Date.now() - lastProximityAt.current > PROXIMITY_COOLDOWN_MS
      ) {
        lastProximityAt.current = Date.now();
        onProximityRef.current?.();
      }
    };

    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [shellRef]);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const tick = () => {
      if (!enabledRef.current) return;
      const idleMs = Date.now() - lastMouse.current.at;
      if (idleMs > 900) {
        targetGaze.current = {
          x: targetGaze.current.x * 0.9,
          y: targetGaze.current.y * 0.9,
        };
        if (Math.abs(targetGaze.current.x) < 0.04) targetGaze.current.x = 0;
        if (Math.abs(targetGaze.current.y) < 0.04) targetGaze.current.y = 0;
      }

      const sgX = springStep(
        gaze.current.x,
        gazeVel.current.x,
        targetGaze.current.x,
      );
      const sgY = springStep(
        gaze.current.y,
        gazeVel.current.y,
        targetGaze.current.y,
      );
      gaze.current = { x: sgX.pos, y: sgY.pos };
      gazeVel.current = { x: sgX.vel, y: sgY.vel };

      const spX = springStep(
        parallax.current.x,
        parallaxVel.current.x,
        targetParallax.current.x,
      );
      const spY = springStep(
        parallax.current.y,
        parallaxVel.current.y,
        targetParallax.current.y,
      );
      parallax.current = { x: spX.pos, y: spY.pos };
      parallaxVel.current = { x: spX.vel, y: spY.vel };

      setMotionVars({
        gazeX: gaze.current.x,
        gazeY: gaze.current.y,
        parallaxX: parallax.current.x,
        parallaxY: parallax.current.y,
      });
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [enabled]);

  const setPointerParallax = useCallback((x: number, y: number) => {
    targetParallax.current = { x, y };
  }, []);

  const clearPointerParallax = useCallback(() => {
    targetParallax.current = { x: 0, y: 0 };
  }, []);

  const nudgeGaze = useCallback((x: number, y: number) => {
    targetGaze.current = { x, y };
    lastMouse.current.at = Date.now();
  }, []);

  return { motionVars, setPointerParallax, clearPointerParallax, nudgeGaze };
}
