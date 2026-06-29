export function createJsonStorageCache<T>(
  loadRaw: () => T,
  saveRaw: (value: T) => void,
): {
  get: () => T;
  set: (value: T) => void;
  invalidate: () => void;
} {
  let cache: T | null = null;

  return {
    get(): T {
      if (cache === null) {
        cache = loadRaw();
      }
      return cache;
    },
    set(value: T): void {
      cache = value;
      saveRaw(value);
    },
    invalidate(): void {
      cache = null;
    },
  };
}
