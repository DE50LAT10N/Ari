import { delay } from "../platform/asyncTimeout";
import type { GigaChatRequestKind } from "./gigaChatDiagnostics";

const MIN_GIGACHAT_REQUEST_GAP_MS = 2_500;
const MAX_GIGACHAT_COOLDOWN_MS = 5 * 60_000;

export type GigaChatQueueOptions = {
  kind?: GigaChatRequestKind;
  priority?: "interactive" | "background";
};

type PendingRequest<T = unknown> = {
  id: number;
  run: () => Promise<T>;
  signal?: AbortSignal;
  kind: GigaChatRequestKind;
  priority: "interactive" | "background";
  started: boolean;
  settled: boolean;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  removeAbortListener: () => void;
};

let lastStartAt = -MIN_GIGACHAT_REQUEST_GAP_MS;
let cooldownUntil = 0;
let throttleFailures = 0;
let queuedRequests = 0;
let nextRequestId = 1;
let pumpRunning = false;
let waitPhase: "idle" | "cooldown" | "gap" = "idle";
let activeKind: GigaChatRequestKind | null = null;
let pending: PendingRequest[] = [];

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Запрос GigaChat отменён.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

async function waitForGigaChatWindow(): Promise<void> {
  const cooldownWait = cooldownUntil - Date.now();
  if (cooldownWait > 0) {
    waitPhase = "cooldown";
    await delay(cooldownWait);
  }

  const gapWait = lastStartAt + MIN_GIGACHAT_REQUEST_GAP_MS - Date.now();
  if (gapWait > 0) {
    waitPhase = "gap";
    await delay(gapWait);
  }
  waitPhase = "idle";
}

function takeNextRequest(): PendingRequest | undefined {
  pending = pending.filter((entry) => !entry.settled);
  let selectedIndex = -1;
  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index];
    if (
      selectedIndex < 0 ||
      (entry.priority === "interactive" &&
        pending[selectedIndex].priority !== "interactive") ||
      (entry.priority === pending[selectedIndex].priority &&
        entry.id < pending[selectedIndex].id)
    ) {
      selectedIndex = index;
    }
  }
  if (selectedIndex < 0) return undefined;
  return pending.splice(selectedIndex, 1)[0];
}

async function pumpQueue(): Promise<void> {
  if (pumpRunning) return;
  pumpRunning = true;
  try {
    while (pending.some((entry) => !entry.settled)) {
      await waitForGigaChatWindow();
      const entry = takeNextRequest();
      if (!entry) continue;
      if (entry.signal?.aborted) {
        entry.settled = true;
        entry.removeAbortListener();
        queuedRequests = Math.max(0, queuedRequests - 1);
        entry.reject(abortError(entry.signal));
        continue;
      }

      entry.started = true;
      activeKind = entry.kind;
      lastStartAt = Date.now();
      try {
        const result = await entry.run();
        recordGigaChatRateSuccess();
        if (!entry.settled) {
          entry.settled = true;
          entry.resolve(result);
        }
      } catch (error) {
        if (!entry.settled) {
          entry.settled = true;
          entry.reject(error);
        }
      } finally {
        entry.removeAbortListener();
        queuedRequests = Math.max(0, queuedRequests - 1);
        activeKind = null;
      }
    }
  } finally {
    waitPhase = "idle";
    pumpRunning = false;
    if (pending.some((entry) => !entry.settled)) {
      void pumpQueue();
    }
  }
}

/** Records only actual provider throttling/service-unavailable statuses. */
export function recordGigaChatThrottle(status: number): void {
  if (status !== 429 && status !== 503 && status !== 504) {
    return;
  }

  throttleFailures = Math.min(throttleFailures + 1, 4);
  const cooldownMs = Math.min(
    MAX_GIGACHAT_COOLDOWN_MS,
    30_000 * 2 ** (throttleFailures - 1),
  );
  cooldownUntil = Math.max(cooldownUntil, Date.now() + cooldownMs);
}

export function recordGigaChatRateSuccess(): void {
  throttleFailures = 0;
  if (cooldownUntil <= Date.now()) {
    cooldownUntil = 0;
  }
}

export function getGigaChatRateLimitState(now = Date.now()): {
  queued: boolean;
  queuedCount: number;
  queuedInteractive: number;
  cooldownMs: number;
  throttleFailures: number;
  phase: "idle" | "cooldown" | "gap" | "running";
  activeKind: GigaChatRequestKind | null;
} {
  return {
    queued: queuedRequests > 0,
    queuedCount: queuedRequests,
    queuedInteractive: pending.filter(
      (entry) => !entry.settled && entry.priority === "interactive",
    ).length,
    cooldownMs: Math.max(0, cooldownUntil - now),
    throttleFailures,
    phase: activeKind ? "running" : waitPhase,
    activeKind,
  };
}

export async function enqueueGigaChatRequest<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
  options: GigaChatQueueOptions = {},
): Promise<T> {
  throwIfAborted(signal);
  queuedRequests += 1;

  return new Promise<T>((resolve, reject) => {
    const entry: PendingRequest<T> = {
      id: nextRequestId++,
      run,
      signal,
      kind: options.kind ?? "json",
      priority: options.priority ?? "background",
      started: false,
      settled: false,
      resolve,
      reject,
      removeAbortListener: () => undefined,
    };
    if (signal) {
      const onAbort = () => {
        if (entry.started || entry.settled) return;
        entry.settled = true;
        queuedRequests = Math.max(0, queuedRequests - 1);
        entry.removeAbortListener();
        reject(abortError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    }
    pending.push(entry as PendingRequest);
    void pumpQueue();
  });
}

export function resetGigaChatRateLimitForTests(): void {
  for (const entry of pending) {
    entry.removeAbortListener();
  }
  lastStartAt = -MIN_GIGACHAT_REQUEST_GAP_MS;
  cooldownUntil = 0;
  throttleFailures = 0;
  queuedRequests = 0;
  nextRequestId = 1;
  pumpRunning = false;
  waitPhase = "idle";
  activeKind = null;
  pending = [];
}
