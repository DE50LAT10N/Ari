import { loadGigaChatAuthKey } from "../platform/gigaChatCredentials";

const SUCCESS_TTL_MS = 30 * 60_000;
const FAILURE_TTL_MS = 5 * 60_000;

let authKeyPresent: boolean | null = null;
let lastSuccessAt = 0;
let lastFailureAt = 0;

export function setGigaChatAuthKeyPresent(present: boolean): void {
  authKeyPresent = present;
}

export function getGigaChatAuthKeyPresent(): boolean | null {
  return authKeyPresent;
}

export function recordGigaChatSuccess(): void {
  lastSuccessAt = Date.now();
  lastFailureAt = 0;
}

export function recordGigaChatFailure(): void {
  lastFailureAt = Date.now();
}

export function isGigaChatProviderOnline(): boolean {
  if (authKeyPresent !== true) {
    return false;
  }
  const now = Date.now();
  if (lastSuccessAt > 0 && now - lastSuccessAt < SUCCESS_TTL_MS) {
    return true;
  }
  if (lastFailureAt > 0 && now - lastFailureAt < FAILURE_TTL_MS) {
    return false;
  }
  return authKeyPresent === true;
}

export function resetGigaChatStatusForTests(): void {
  authKeyPresent = null;
  lastSuccessAt = 0;
  lastFailureAt = 0;
}

export async function refreshGigaChatAuthCache(): Promise<boolean> {
  try {
    const key = await loadGigaChatAuthKey();
    const present = Boolean(key?.trim());
    setGigaChatAuthKeyPresent(present);
    return present;
  } catch {
    setGigaChatAuthKeyPresent(false);
    return false;
  }
}
