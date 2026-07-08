const selectorCursors = new Map<string, number>();

export function pickDeterministic<T>(
  key: string,
  items: readonly T[],
): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const previous = selectorCursors.get(key) ?? -1;
  const next = (previous + 1) % items.length;
  selectorCursors.set(key, next);
  return items[next];
}

export function resetDeterministicSelectorsForTests(): void {
  selectorCursors.clear();
}
