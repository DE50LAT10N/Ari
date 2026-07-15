export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export type TimeoutOperation<T> =
  | Promise<T>
  | ((signal: AbortSignal) => Promise<T>);

export type TimeoutOptions = {
  /** Cancels the wrapper and is forwarded to callback-style operations. */
  signal?: AbortSignal;
};

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  return new DOMException("Операция отменена.", "AbortError");
}

function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) {
    return () => undefined;
  }
  const abort = () => target.abort(abortError(source));
  if (source.aborted) {
    abort();
    return () => undefined;
  }
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

export async function withTimeout<T>(
  operation: TimeoutOperation<T>,
  ms: number,
  label: string,
  options: TimeoutOptions = {},
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new RangeError("Timeout должен быть положительным числом миллисекунд.");
  }

  const controller = new AbortController();
  const unlinkExternalSignal = linkAbortSignal(options.signal, controller);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: () => void = () => undefined;
  const promise =
    typeof operation === "function"
      ? Promise.resolve().then(() => operation(controller.signal))
      : operation;
  timer = setTimeout(() => {
    controller.abort(
      new TimeoutError(`${label}: превышено ${Math.round(ms / 1000)} с`),
    );
  }, ms);
  const aborted = new Promise<never>((_, reject) => {
    const rejectAbort = () => reject(abortError(controller.signal));
    if (controller.signal.aborted) {
      rejectAbort();
      return;
    }
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    removeAbortListener = () =>
      controller.signal.removeEventListener("abort", rejectAbort);
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    removeAbortListener();
    unlinkExternalSignal();
  }
}

export function delay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, milliseconds));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Lets the browser paint status updates before heavy CPU work. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
