import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../settings/appSettings";

export type ActiveWindowInfo = {
  title: string;
  processName: string;
};

const LAST_EXTERNAL_WINDOW_KEY = "desktop-character.last-external-window.v1";

export function isAriWindow(windowInfo: ActiveWindowInfo): boolean {
  return (
    windowInfo.title === "Ari Desktop Character" ||
    windowInfo.processName.toLowerCase().includes("desktop-character")
  );
}

export function loadLastExternalWindow(): ActiveWindowInfo | null {
  try {
    const stored = localStorage.getItem(LAST_EXTERNAL_WINDOW_KEY);
    return stored ? (JSON.parse(stored) as ActiveWindowInfo) : null;
  } catch {
    return null;
  }
}

export function saveLastExternalWindow(windowInfo: ActiveWindowInfo): void {
  localStorage.setItem(LAST_EXTERNAL_WINDOW_KEY, JSON.stringify(windowInfo));
}

function allowedOrNull(
  windowInfo: ActiveWindowInfo | null,
  allowlistValue: string,
): ActiveWindowInfo | null {
  if (!windowInfo) {
    return null;
  }
  return matchesActivityAllowlist(windowInfo, allowlistValue)
    ? windowInfo
    : null;
}

export function matchesActivityAllowlist(
  windowInfo: ActiveWindowInfo,
  allowlistValue: string,
): boolean {
  const allowlist = allowlistValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return (
    allowlist.length === 0 ||
    allowlist.some((allowed) =>
      windowInfo.processName.toLowerCase().includes(allowed),
    )
  );
}

export type ActiveWindowContextOptions = {
  bypassPrivacyGate?: boolean;
};

export async function getActiveWindowContext(
  settings: AppSettings,
  opts?: ActiveWindowContextOptions,
): Promise<ActiveWindowInfo | null> {
  if (!opts?.bypassPrivacyGate && !settings.activityTrackingEnabled) {
    return null;
  }

  const activeWindow = await invoke<ActiveWindowInfo | null>(
    "get_active_window",
  );
  if (!activeWindow) {
    return null;
  }

  if (isAriWindow(activeWindow)) {
    if (opts?.bypassPrivacyGate) {
      return null;
    }
    return allowedOrNull(loadLastExternalWindow(), settings.activityAllowlist);
  }

  if (
    !opts?.bypassPrivacyGate &&
    !matchesActivityAllowlist(activeWindow, settings.activityAllowlist)
  ) {
    return null;
  }

  saveLastExternalWindow(activeWindow);

  return activeWindow;
}
