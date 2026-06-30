import type { AppSettings } from "../settings/appSettings";
import type { InitiativeKind } from "./initiativeKinds";

export const URGENT_ADVICE_MIN_MS = 5 * 60_000;
export const MEDIUM_ADVICE_CAP_MS = 10 * 60_000;

export function allowsGenericCompanionInitiative(
  activityAgoMs: number,
  plannedSilenceMs: number,
  options: {
    immersedCompanion?: boolean;
    companionSilenceMs?: number;
    companionSilenceMinMs?: number;
  } = {},
): boolean {
  if (
    options.immersedCompanion &&
    options.companionSilenceMs !== undefined &&
    options.companionSilenceMinMs !== undefined
  ) {
    return options.companionSilenceMs >= options.companionSilenceMinMs;
  }
  return activityAgoMs >= plannedSilenceMs;
}

export function prefersLocalCompanionLines(
  _settings: AppSettings,
  _intervalMs: number,
  options: { practicalContext?: boolean; llmOffline?: boolean } = {},
): boolean {
  if (!options.llmOffline) {
    return false;
  }
  return !options.practicalContext;
}

export function shouldUseIdleLineFallback(
  settings: AppSettings,
  llmOnline: boolean,
): boolean {
  return prefersLocalCompanionLines(settings, 0, { llmOffline: !llmOnline });
}

export function proactiveIntervalMs(settings: AppSettings): number {
  const baseMinutes = Math.max(1, settings.proactiveIntervalMinutes);
  switch (settings.initiativeLevel) {
    case "silent":
      return baseMinutes * 60 * 1000 * 2.5;
    case "rare":
      return baseMinutes * 60 * 1000 * 1.6;
    case "active":
      return baseMinutes * 60 * 1000 * 0.65;
    default:
      return baseMinutes * 60 * 1000;
  }
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

/** Telemetry-only; no practical daily limit on initiatives. */
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
