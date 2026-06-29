import type { AppSettings } from "../settings/appSettings";

export function isQuietHours(
  settings: AppSettings,
  date = new Date(),
): boolean {
  const start = Math.max(0, Math.min(23, settings.quietHoursStart));
  const end = Math.max(0, Math.min(23, settings.quietHoursEnd));
  const hour = date.getHours();

  if (start === end) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

export function formatReminderTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
