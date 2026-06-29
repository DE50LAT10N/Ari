import type { AppSettings } from "../settings/appSettings";

export type LifecycleState =
  | "awake"
  | "observing"
  | "quiet"
  | "sleepy"
  | "sleeping"
  | "dnd";

export function deriveLifecycleState(
  idleSeconds: number,
  hour: number,
  quietMode: AppSettings["quietMode"],
  quietModeActive: boolean,
): LifecycleState {
  if (quietMode === "manual" || quietModeActive) {
    return "dnd";
  }

  if (idleSeconds >= 3 * 60 * 60) {
    return "sleeping";
  }

  if (idleSeconds >= 30 * 60 || hour >= 23 || hour < 6) {
    return "sleepy";
  }

  if (hour >= 22 || hour < 8) {
    return "quiet";
  }

  if (idleSeconds >= 5 * 60) {
    return "observing";
  }

  return "awake";
}

export function lifecycleOpacity(state: LifecycleState): number {
  return {
    awake: 1,
    observing: 0.95,
    quiet: 0.88,
    sleepy: 0.75,
    sleeping: 0.55,
    dnd: 0.82,
  }[state];
}

export function blocksInitiative(state: LifecycleState): boolean {
  return state === "sleeping" || state === "dnd";
}
