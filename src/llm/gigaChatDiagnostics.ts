export type GigaChatRequestKind =
  | "chat"
  | "json"
  | "vision"
  | "embedding"
  | "status";

export type GigaChatDiagnosticOutcome =
  | "success"
  | "empty"
  | "http_error"
  | "transport_error"
  | "timeout"
  | "aborted";

export type GigaChatDiagnosticEntry = {
  at: number;
  kind: GigaChatRequestKind;
  model?: string;
  outcome: GigaChatDiagnosticOutcome;
  status?: number;
  finishReason?: string;
  durationMs: number;
  eventCount?: number;
  contentChunks?: number;
  malformedEvents?: number;
  detail?: string;
};

const STORAGE_KEY = "desktop-character.gigachat-diagnostics.v1";
const MAX_ENTRIES = 30;
let memoryEntries: GigaChatDiagnosticEntry[] = [];

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

function sanitize(entry: GigaChatDiagnosticEntry): GigaChatDiagnosticEntry {
  return {
    ...entry,
    model: entry.model?.slice(0, 80),
    finishReason: entry.finishReason?.slice(0, 80),
    detail: entry.detail?.slice(0, 240),
  };
}

export function loadGigaChatDiagnostics(): GigaChatDiagnosticEntry[] {
  if (!storageAvailable()) return [...memoryEntries];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? (parsed as GigaChatDiagnosticEntry[]).slice(-MAX_ENTRIES)
      : [];
  } catch {
    return [...memoryEntries];
  }
}

export function recordGigaChatDiagnostic(
  entry: GigaChatDiagnosticEntry,
): void {
  const next = [...loadGigaChatDiagnostics(), sanitize(entry)].slice(-MAX_ENTRIES);
  memoryEntries = next;
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Diagnostics must never break reply generation.
  }
}

export function resetGigaChatDiagnosticsForTests(): void {
  memoryEntries = [];
  if (storageAvailable()) {
    localStorage.removeItem(STORAGE_KEY);
  }
}
