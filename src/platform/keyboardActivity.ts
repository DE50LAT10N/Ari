import { invoke } from "@tauri-apps/api/core";

export type KeyboardActivitySnapshot = {
  observedMs: number;
  printableKeyCount: number;
  backspaceCount: number;
  deleteCount: number;
  escapeCount: number;
  enterCount: number;
  tabCount: number;
  navigationCount: number;
  modifierCount: number;
  undoCount: number;
  saveCount: number;
  burstCount: number;
  active: boolean;
};

export type KeyboardActivityConfig = {
  pollIntervalMs: number;
  minWindowDwellMs: number;
  correctionChurnMin: number;
  escapeChurnMin: number;
  commandLoopMin: number;
  printableBurstMin: number;
};

export const KEYBOARD_ACTIVITY_CONFIG: KeyboardActivityConfig = {
  pollIntervalMs: 5_000,
  minWindowDwellMs: 60_000,
  correctionChurnMin: 4,
  escapeChurnMin: 2,
  commandLoopMin: 3,
  printableBurstMin: 18,
};

export const EMPTY_KEYBOARD_ACTIVITY: KeyboardActivitySnapshot = {
  observedMs: 0,
  printableKeyCount: 0,
  backspaceCount: 0,
  deleteCount: 0,
  escapeCount: 0,
  enterCount: 0,
  tabCount: 0,
  navigationCount: 0,
  modifierCount: 0,
  undoCount: 0,
  saveCount: 0,
  burstCount: 0,
  active: false,
};

export async function getKeyboardActivitySnapshot(): Promise<KeyboardActivitySnapshot> {
  try {
    return await invoke<KeyboardActivitySnapshot>(
      "get_keyboard_activity_snapshot",
    );
  } catch {
    return EMPTY_KEYBOARD_ACTIVITY;
  }
}
