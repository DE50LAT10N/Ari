import type { IdeClientKind, IdePairingSession } from "./protocol";

const DEFAULT_PAIRING_TTL_MS = 2 * 60_000;
const MIN_PAIRING_TTL_MS = 30_000;
const MAX_PAIRING_TTL_MS = 5 * 60_000;

function secureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createIdePairingSession(options: {
  now?: number;
  ttlMs?: number;
  expectedClient?: IdeClientKind;
} = {}): IdePairingSession {
  const now = options.now ?? Date.now();
  const ttlMs = Math.max(
    MIN_PAIRING_TTL_MS,
    Math.min(MAX_PAIRING_TTL_MS, options.ttlMs ?? DEFAULT_PAIRING_TTL_MS),
  );
  return {
    sessionId: globalThis.crypto.randomUUID(),
    token: secureToken(),
    expiresAt: now + ttlMs,
    expectedClient: options.expectedClient,
  };
}

