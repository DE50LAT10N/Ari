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

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJsonArray<T>(key: string, items: T[], maxItems: number): void {
  localStorage.setItem(key, JSON.stringify(items.slice(0, maxItems)));
}

export function saveJsonTail<T>(key: string, items: T[], maxItems: number): void {
  localStorage.setItem(key, JSON.stringify(items.slice(-maxItems)));
}
