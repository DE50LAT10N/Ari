import type { CharacterEmotion } from "../types/character";

export type UiSound =
  | "chat-open"
  | "chat-close"
  | "overlay"
  | "pomodoro-start"
  | "pomodoro-break"
  | "pomodoro-end"
  | "focus-session-start"
  | "focus-session-end"
  | "reminder"
  | "reaction-overlay"
  | "error";

const soundFrequencies: Record<UiSound, [number, number]> = {
  "chat-open": [520, 680],
  "chat-close": [480, 360],
  overlay: [760, 620],
  "pomodoro-start": [440, 520],
  "pomodoro-break": [520, 440],
  "pomodoro-end": [620, 480],
  "focus-session-start": [400, 500],
  "focus-session-end": [500, 380],
  reminder: [680, 820],
  "reaction-overlay": [700, 640],
  error: [320, 240],
};

const emotionReactionFrequencies: Partial<
  Record<CharacterEmotion, [number, number]>
> = {
  happy: [620, 760],
  excited: [680, 820],
  amused: [640, 720],
  curious: [560, 680],
  empathetic: [480, 560],
  calm: [420, 500],
  annoyed: [360, 300],
  surprised: [720, 880],
  sad: [380, 320],
  worried: [440, 380],
  proud: [600, 700],
  shy: [500, 580],
  blush: [540, 620],
  determined: [520, 640],
  pensive: [460, 520],
  bored: [400, 360],
  sleepy: [340, 300],
};

export function playUiSound(
  kind: UiSound,
  enabled: boolean,
  night: boolean,
  options?: {
    bodyDoubling?: boolean;
    focusActive?: boolean;
    reactionEmotion?: CharacterEmotion;
  },
): void {
  if (!enabled) return;

  const bodyDoubling = options?.bodyDoubling ?? false;
  const focusActive = options?.focusActive ?? false;
  const allowedDuringFocus =
    kind === "error" || kind === "reminder";

  if (bodyDoubling && !allowedDuringFocus) return;
  if (focusActive && !allowedDuringFocus && kind.startsWith("pomodoro")) {
    return;
  }
  if (night && kind !== "error" && kind !== "reminder") return;

  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const emotionFreq =
      kind === "reaction-overlay" && options?.reactionEmotion
        ? emotionReactionFrequencies[options.reactionEmotion]
        : undefined;
    const [startFreq, endFreq] = emotionFreq ?? soundFrequencies[kind];
    oscillator.type = emotionFreq ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(startFreq, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      endFreq,
      context.currentTime + 0.07,
    );
    const volume = kind === "error" ? 0.05 : emotionFreq ? 0.04 : 0.035;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.09);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.1);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Sound is decorative and must never affect interaction.
  }
}
