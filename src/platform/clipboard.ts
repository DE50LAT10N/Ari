import { invoke } from "@tauri-apps/api/core";
import type { ClipboardSignalKind } from "../memory/activitySignals";
import { isClipboardSemanticallyRich } from "./clipboardSemantics";

export type ClipboardContentKind = ClipboardSignalKind;

export function classifyClipboardText(text: string): ClipboardContentKind {
  const trimmed = text.trim();
  if (!trimmed) {
    return "text";
  }
  if (/^https?:\/\/\S+/i.test(trimmed) || /^www\.\S+/i.test(trimmed)) {
    return "url";
  }
  if (
    /(?:traceback|stack trace|exception|panic:|Caused by:|at\s+\S+\(|\.java:\d+|\.ts:\d+|\.py:\d+)/i.test(
      trimmed,
    )
  ) {
    return "stacktrace";
  }
  if (
    /(?:error|warning|failed|failure|cannot|denied|not found|timeout|status\s+\d{3}|npm ERR!|cargo|vite|tsc|eslint|diagnostic|ошиб|предупрежд|не найден|отказано)/i.test(
      trimmed,
    )
  ) {
    return "diagnostic";
  }
  if (
    /(?:function\s+\w+|const\s+\w+\s*=|import\s+.+\s+from|class\s+\w+|def\s+\w+\(|public\s+(?:static\s+)?(?:void|class)|#include\s+<|fn\s+\w+\(|interface\s+\w+)/.test(
      trimmed,
    )
  ) {
    return "code";
  }
  if (isClipboardSemanticallyRich(trimmed)) {
    return "code";
  }
  return "text";
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
