import { invoke } from "@tauri-apps/api/core";
import type { ClipboardSignalKind } from "../memory/activitySignals";
import { classifyClipboardSignal } from "./clipboardClassifier";

export type ClipboardContentKind = ClipboardSignalKind;

export function classifyClipboardText(text: string): ClipboardContentKind {
  return classifyClipboardSignal(text).kind;
}

export async function readClipboardText(): Promise<string | null> {
  try {
    const text = await invoke<string>("read_clipboard_text");
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
