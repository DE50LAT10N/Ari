import type { ClipboardSignalKind } from "../memory/activitySignals";
import { isClipboardSemanticallyRich } from "./clipboardSemantics";

export type ClipboardClassification = {
  kind: ClipboardSignalKind;
  evidence: string;
};

const DIAGNOSTIC_WORDS = [
  "error",
  "warning",
  "failed",
  "failure",
  "cannot",
  "denied",
  "not found",
  "timeout",
  "diagnostic",
  "ошиб",
  "предупрежд",
  "не найден",
  "отказано",
];

function parseUrl(value: string): URL | null {
  const candidate = value.startsWith("www.") ? `https://${value}` : value;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function hasStackFrame(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return lines.some((line) => {
    if (line.startsWith("at ") && line.includes("(") && line.includes(")")) {
      return true;
    }
    if (line.startsWith("File ") && line.includes(", line ")) {
      return true;
    }
    return /[\w./\\-]+\.(?:ts|tsx|js|jsx|py|java|rs|go|cs):\d+/.test(line);
  });
}

function hasCodeShape(text: string): boolean {
  const first = firstMeaningfulLine(text);
  if (!first) {
    return false;
  }
  if (/^(import|export|const|let|var|class|interface|type|function)\b/.test(first)) {
    return true;
  }
  if (/^(def|class)\s+\w+/.test(first)) {
    return true;
  }
  if (/^(public|private|protected)\s+/.test(first)) {
    return true;
  }
  return /(?:=>|::|#include\s+<|fn\s+\w+\(|\{.*\})/.test(text);
}

function hasDiagnosticWord(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    DIAGNOSTIC_WORDS.some((word) => normalized.includes(word)) ||
    /status\s+\d{3}/i.test(text) ||
    /npm ERR!|cargo|vite|tsc|eslint/i.test(text)
  );
}

export function classifyClipboardSignal(
  text: string,
): ClipboardClassification {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "text", evidence: "empty" };
  }
  if (parseUrl(trimmed)) {
    return { kind: "url", evidence: "url parser" };
  }
  if (hasStackFrame(trimmed)) {
    return { kind: "stacktrace", evidence: "stack frame" };
  }
  if (hasDiagnosticWord(trimmed)) {
    return { kind: "diagnostic", evidence: "diagnostic term" };
  }
  if (hasCodeShape(trimmed) || isClipboardSemanticallyRich(trimmed)) {
    return { kind: "code", evidence: "code shape" };
  }
  return { kind: "text", evidence: "fallback" };
}
