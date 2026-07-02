import { delay } from "../platform/asyncTimeout";

const MIN_GIGACHAT_REQUEST_GAP_MS = 2_500;
const MAX_GIGACHAT_COOLDOWN_MS = 5 * 60_000;

let queue: Promise<void> = Promise.resolve();
let lastStartAt = -MIN_GIGACHAT_REQUEST_GAP_MS;
let cooldownUntil = 0;
let throttleFailures = 0;
let queuedRequests = 0;

async function waitForGigaChatTurn(): Promise<void> {
  const cooldownWait = cooldownUntil - Date.now();
  if (cooldownWait > 0) {
    await delay(cooldownWait);
  }

  const gapWait = lastStartAt + MIN_GIGACHAT_REQUEST_GAP_MS - Date.now();
  if (gapWait > 0) {
    await delay(gapWait);
  }

  lastStartAt = Date.now();
}

export function recordGigaChatThrottle(status?: number): void {
  if (status !== undefined && status !== 429 && status !== 503 && status !== 504) {
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
  cooldownMs: number;
  throttleFailures: number;
} {
  return {
    queued: queuedRequests > 0,
    cooldownMs: Math.max(0, cooldownUntil - now),
    throttleFailures,
  };
}

export async function enqueueGigaChatRequest<T>(
  run: () => Promise<T>,
): Promise<T> {
  queuedRequests += 1;
  const previous = queue;
  let release: () => void = () => undefined;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);
  try {
    await waitForGigaChatTurn();
    const result = await run();
    recordGigaChatRateSuccess();
    return result;
  } finally {
    queuedRequests = Math.max(0, queuedRequests - 1);
    release();
  }
}

export function resetGigaChatRateLimitForTests(): void {
  queue = Promise.resolve();
  lastStartAt = -MIN_GIGACHAT_REQUEST_GAP_MS;
  cooldownUntil = 0;
  throttleFailures = 0;
  queuedRequests = 0;
}
