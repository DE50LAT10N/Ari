import type { AppSettings } from "../settings/appSettings";
import type { InitiativeKind } from "./initiativeKinds";

export const URGENT_ADVICE_MIN_MS = 5 * 60_000;
export const MEDIUM_ADVICE_CAP_MS = 10 * 60_000;
export const ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS = 45_000;

export function allowsGenericCompanionInitiative(
  activityAgoMs: number,
  plannedSilenceMs: number,
  options: {
    activeLevel?: boolean;
    immersedCompanion?: boolean;
    companionSilenceMs?: number;
    companionSilenceMinMs?: number;
  } = {},
): boolean {
  if (options.activeLevel) {
    return true;
  }
  if (
    options.immersedCompanion &&
    options.companionSilenceMs !== undefined &&
    options.companionSilenceMinMs !== undefined
  ) {
    return options.companionSilenceMs >= options.companionSilenceMinMs;
  }
  return activityAgoMs >= plannedSilenceMs;
}

function scaleProactiveIntervalMs(
  baseMinutes: number,
  settings: AppSettings,
): number {
  const safeBaseMinutes = Math.max(1, baseMinutes);
  switch (settings.initiativeLevel) {
    case "silent":
      return safeBaseMinutes * 60 * 1000 * 2.5;
    case "rare":
      return safeBaseMinutes * 60 * 1000 * 1.6;
    case "active":
      return safeBaseMinutes * 60 * 1000 * 0.35;
    default:
      return safeBaseMinutes * 60 * 1000;
  }
}

export function proactiveSmalltalkIntervalMs(settings: AppSettings): number {
  return scaleProactiveIntervalMs(
    settings.proactiveSmalltalkIntervalMinutes ??
      Math.max(5, Math.round((settings.proactiveIntervalMinutes || 20) * 0.5)),
    settings,
  );
}

export function proactiveAdviceIntervalMs(settings: AppSettings): number {
  return scaleProactiveIntervalMs(
    settings.proactiveAdviceIntervalMinutes ??
      settings.proactiveIntervalMinutes ??
      20,
    settings,
  );
}

export function idleLineProbability(settings: AppSettings): number {
  switch (settings.initiativeLevel) {
    case "silent":
      return 0.12;
    case "rare":
      return 0.22;
    case "active":
      return 0.48;
    default:
      return 0.32;
  }
}

const UNLIMITED_DAILY = 9999;

/** Cooldowns control pacing; the user prefers no hard daily shutdown. */
export function dailyInitiativeCap(_settings: AppSettings): number {
  return UNLIMITED_DAILY;
}

export function initiativeRiskTolerance(settings: AppSettings): number {
  switch (settings.initiativeLevel) {
    case "silent":
      return -1;
    case "rare":
      return 0;
    case "active":
      return 1;
    default:
      return 0;
  }
}

export function dailyInitiativeKindCap(
  _kind: InitiativeKind,
  _settings: AppSettings,
): number {
  return UNLIMITED_DAILY;
}
