export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

export function uniqueStrings<T>(values: T[]): T[] {
  return [...new Set(values)];
}
