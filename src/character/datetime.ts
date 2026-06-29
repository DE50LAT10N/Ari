export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function formatRuDateTime(
  value: Date | number | string = new Date(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("ru-RU");
}
