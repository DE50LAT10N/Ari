export function loadJsonArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function saveJsonArray<T>(key: string, items: T[], maxItems: number): void {
  localStorage.setItem(key, JSON.stringify(items.slice(0, maxItems)));
}
