import type { AttentionState } from "../character/attention";
import type { CharacterMood } from "../character/mood";

export type IdleActionId = "stretch" | "look" | "tilt" | "sigh";

const IDLE_ACTIONS: Array<{
  id: IdleActionId;
  className: string;
  weight: number;
}> = [
  { id: "stretch", className: "idle-stretch", weight: 1.1 },
  { id: "look", className: "idle-look", weight: 1.2 },
  { id: "tilt", className: "idle-tilt", weight: 1 },
  { id: "sigh", className: "idle-sigh", weight: 0.85 },
];

export function pickIdleAction(
  mood: CharacterMood,
  attention: AttentionState,
): IdleActionId | null {
  if (attention === "sleepy" || attention === "daydreaming") {
    return Math.random() < 0.55 ? "sigh" : "tilt";
  }
  if (mood.energy < 0.28) {
    return Math.random() < 0.5 ? "sigh" : "stretch";
  }
  if (mood.energy > 0.7 && attention === "focused") {
    return Math.random() < 0.45 ? "look" : "tilt";
  }

  const total = IDLE_ACTIONS.reduce((sum, action) => sum + action.weight, 0);
  let roll = Math.random() * total;
  for (const action of IDLE_ACTIONS) {
    roll -= action.weight;
    if (roll <= 0) return action.id;
  }
  return IDLE_ACTIONS[0]?.id ?? null;
}

export function idleActionClass(id: IdleActionId | null): string {
  if (!id) return "";
  return IDLE_ACTIONS.find((action) => action.id === id)?.className ?? "";
}
