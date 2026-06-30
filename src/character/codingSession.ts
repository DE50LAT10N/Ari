export type CodingSession = {
  processName: string;
  since: number;
} | null;

export function touchCodingSession(
  current: CodingSession,
  processName: string,
  isCoding: boolean,
  now = Date.now(),
): CodingSession {
  if (!isCoding || !processName.trim()) {
    return null;
  }
  if (current?.processName === processName) {
    return current;
  }
  return { processName, since: now };
}

export function codingSessionMinutes(
  session: CodingSession,
  now = Date.now(),
): number {
  if (!session) {
    return 0;
  }
  return Math.round((now - session.since) / 60_000);
}

export function codingSessionMs(session: CodingSession, now = Date.now()): number {
  if (!session) {
    return 0;
  }
  return Math.max(0, now - session.since);
}
