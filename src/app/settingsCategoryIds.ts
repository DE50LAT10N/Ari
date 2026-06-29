export const SETTINGS_CATEGORY_IDS = [
  "provider",
  "personality",
  "initiative",
  "memory",
  "vision",
  "voice",
  "privacy",
  "safety",
  "tasks",
  "system",
] as const;

export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number];

const STORAGE_KEY = "desktop-character.settings-open-categories.v1";

export function loadOpenCategories(): Set<SettingsCategoryId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Set<SettingsCategoryId>(["provider"]);
    }
    const parsed = JSON.parse(raw) as string[];
    const valid = parsed.filter((id): id is SettingsCategoryId =>
      SETTINGS_CATEGORY_IDS.includes(id as SettingsCategoryId),
    );
    return valid.length ? new Set(valid) : new Set<SettingsCategoryId>(["provider"]);
  } catch {
    return new Set<SettingsCategoryId>(["provider"]);
  }
}

export function saveOpenCategories(open: Set<SettingsCategoryId>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...open]));
}
