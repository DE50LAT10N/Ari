import type { IdeWorkspaceSnapshot } from "./protocol";
import { IDE_MAX_CLOCK_SKEW_MS } from "./snapshotValidation";

export const IDE_ADVISOR_MAX_SNAPSHOT_AGE_MS = 60_000;

export function isIdeAdvisorSnapshotFresh(
  snapshot: IdeWorkspaceSnapshot,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(now)) return false;
  const ageMs = now - snapshot.capturedAt;
  return (
    ageMs >= -IDE_MAX_CLOCK_SKEW_MS &&
    ageMs <= IDE_ADVISOR_MAX_SNAPSHOT_AGE_MS &&
    snapshot.expiresAt > now &&
    snapshot.expiresAt > snapshot.capturedAt
  );
}
