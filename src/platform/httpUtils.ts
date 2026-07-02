export function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function httpErrorFromResponse(
  status: number,
  raw: string,
  label: string,
): string {
  const trimmed = raw.trim().slice(0, 240);
  if (trimmed) {
    return `${label}: HTTP ${status} — ${trimmed}`;
  }
  return `${label}: HTTP ${status}`;
}
