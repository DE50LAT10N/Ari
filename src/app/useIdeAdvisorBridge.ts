import { useCallback, useEffect, useRef, useState } from "react";
import type { IdeWorkspaceSnapshot } from "../ide/protocol";
import { isIdeAdvisorSnapshotFresh } from "../ide/snapshotFreshness";
import {
  getIdeBridgeSnapshot,
  getIdeBridgeStatus,
  startIdeBridge,
  stopIdeBridge,
  subscribeIdeBridgeUpdates,
  type IdeBridgeNativeStatus,
} from "../platform/ideBridgeNative";

const DISABLED_STATUS: IdeBridgeNativeStatus = {
  protocolVersion: 1,
  running: false,
  connection: "stopped",
};

export type IdeAdvisorBridgeState = {
  status: IdeBridgeNativeStatus;
  snapshot: IdeWorkspaceSnapshot | null;
  error: string | null;
  refresh: () => Promise<IdeAdvisorRefreshResult>;
};

export type IdeAdvisorRefreshResult = Omit<IdeAdvisorBridgeState, "refresh">;

export function useIdeAdvisorBridge(enabled: boolean): IdeAdvisorBridgeState {
  const [status, setStatus] = useState<IdeBridgeNativeStatus>(DISABLED_STATUS);
  const [snapshot, setSnapshot] = useState<IdeWorkspaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshSequenceRef = useRef(0);

  const refresh = useCallback(async (): Promise<IdeAdvisorRefreshResult> => {
    const refreshSequence = ++refreshSequenceRef.current;
    const applyIfCurrent = (result: IdeAdvisorRefreshResult) => {
      if (refreshSequence !== refreshSequenceRef.current) return;
      setStatus(result.status);
      setSnapshot(result.snapshot);
      setError(result.error);
    };
    if (!enabled) {
      const result: IdeAdvisorRefreshResult = {
        status: DISABLED_STATUS,
        snapshot: null,
        error: null,
      };
      applyIfCurrent(result);
      return result;
    }
    try {
      await startIdeBridge();
      const [nextStatus, nextSnapshot] = await Promise.all([
        getIdeBridgeStatus(),
        getIdeBridgeSnapshot(),
      ]);
      const snapshotMatchesStatus =
        nextSnapshot !== null &&
        nextStatus.connection === "paired" &&
        (!nextStatus.latestWorkspaceId ||
          nextStatus.latestWorkspaceId === nextSnapshot.workspaceId) &&
        (nextStatus.latestRevision === undefined ||
          nextStatus.latestRevision === nextSnapshot.revision) &&
        isIdeAdvisorSnapshotFresh(nextSnapshot);
      const result: IdeAdvisorRefreshResult = {
        status: nextStatus,
        snapshot: snapshotMatchesStatus ? nextSnapshot : null,
        error: null,
      };
      applyIfCurrent(result);
      return result;
    } catch (refreshError) {
      const result: IdeAdvisorRefreshResult = {
        status: DISABLED_STATUS,
        snapshot: null,
        error: refreshError instanceof Error
          ? refreshError.message
          : "IDE Bridge недоступен.",
      };
      applyIfCurrent(result);
      return result;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      refreshSequenceRef.current += 1;
      setStatus(DISABLED_STATUS);
      setSnapshot(null);
      setError(null);
      void stopIdeBridge().catch(() => undefined);
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refreshIfMounted = async () => {
      if (!disposed) {
        await refresh();
      }
    };
    void refreshIfMounted();
    void subscribeIdeBridgeUpdates(() => {
      void refreshIfMounted();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    const timer = window.setInterval(() => {
      void refreshIfMounted();
    }, 15_000);
    return () => {
      disposed = true;
      refreshSequenceRef.current += 1;
      window.clearInterval(timer);
      unlisten?.();
    };
  }, [enabled, refresh]);

  return { status, snapshot, error, refresh };
}
