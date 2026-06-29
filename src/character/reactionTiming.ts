export const REACTION_OVERLAY_MS = 3600;
export const REACTION_AMBIENT_MS = 3400;
export const REACTION_THINKING_MS = 4000;

export function overlayDurationMs(
  type: "thinking" | "question" | "surprise" | "sparkles" | "anger" | "heart",
): number {
  return type === "thinking" ? REACTION_THINKING_MS : REACTION_OVERLAY_MS;
}
