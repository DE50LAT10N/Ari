export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: превышено ${Math.round(ms / 1000)} с`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** Lets the browser paint status updates before heavy CPU work. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
