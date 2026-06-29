import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";

export function isQuietModeActive(
  settings: AppSettings,
  activeWindow?: ActiveWindowInfo | null,
): boolean {
  if (settings.quietMode === "manual") return true;
  if (
    settings.quietMode === "until" &&
    typeof settings.quietModeUntil === "number"
  ) {
    return Date.now() < settings.quietModeUntil;
  }
  if (settings.quietMode === "process") {
    return Boolean(
      settings.quietModeProcess &&
        activeWindow?.processName.toLowerCase() ===
          settings.quietModeProcess.toLowerCase(),
    );
  }
  return false;
}

export function quietModeLabel(settings: AppSettings): string {
  if (settings.quietMode === "manual") return "до ручного отключения";
  if (settings.quietMode === "process") {
    return `пока открыт ${settings.quietModeProcess || "текущий процесс"}`;
  }
  if (settings.quietMode === "until" && settings.quietModeUntil) {
    if (Date.now() >= settings.quietModeUntil) return "выключен";
    return `до ${new Date(settings.quietModeUntil).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  return "выключен";
}
