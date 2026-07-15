import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { IdeClientKind, IdeWorkspaceSnapshot } from "../ide/protocol";
import {
  validateIdeWorkspaceSnapshotShape,
  validateSnapshotIntegrity,
} from "../ide/snapshotValidation";

export type IdeBridgeConnectionState =
  | "stopped"
  | "waiting"
  | "paired"
  | "expired";

export type IdeBridgeNativeStatus = {
  protocolVersion: 1;
  running: boolean;
  connection: IdeBridgeConnectionState;
  endpoint?: string;
  sessionId?: string;
  expiresAt?: number;
  client?: IdeClientKind;
  clientInstanceId?: string;
  lastSequence?: number;
  latestWorkspaceId?: string;
  latestRevision?: number;
  lastMessageAt?: number;
  connectionFile?: string;
};

export type IdeBridgeUpdate = {
  protocolVersion: 1;
  type: string;
  workspaceId?: string;
  revision?: number;
  receivedAt: number;
  client?: IdeClientKind;
  clientInstanceId?: string;
};

const STOPPED_STATUS: IdeBridgeNativeStatus = {
  protocolVersion: 1,
  running: false,
  connection: "stopped",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 4096 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseStatus(value: unknown): IdeBridgeNativeStatus {
  if (!isRecord(value)) {
    return STOPPED_STATUS;
  }
  const connection = value.connection;
  const normalizedConnection: IdeBridgeConnectionState =
    connection === "waiting" ||
    connection === "paired" ||
    connection === "expired"
      ? connection
      : "stopped";
  const client = value.client;
  const normalizedClient: IdeClientKind | undefined =
    client === "vscode" ||
    client === "jetbrains" ||
    client === "terminal" ||
    client === "test"
      ? client
      : undefined;
  return {
    protocolVersion: 1,
    running: value.running === true,
    connection: normalizedConnection,
    endpoint: optionalString(value.endpoint),
    sessionId: optionalString(value.sessionId),
    expiresAt: optionalNumber(value.expiresAt),
    client: normalizedClient,
    clientInstanceId: optionalString(value.clientInstanceId),
    lastSequence: optionalNumber(value.lastSequence),
    latestWorkspaceId: optionalString(value.latestWorkspaceId),
    latestRevision: optionalNumber(value.latestRevision),
    lastMessageAt: optionalNumber(value.lastMessageAt),
    connectionFile: optionalString(value.connectionFile),
  };
}

function looksLikeSnapshot(value: unknown): value is IdeWorkspaceSnapshot {
  if (!isRecord(value) || !isRecord(value.provenance) || !isRecord(value.sharing)) {
    return false;
  }
  return (
    typeof value.workspaceId === "string" &&
    typeof value.projectId === "string" &&
    Array.isArray(value.roots) &&
    typeof value.revision === "number" &&
    typeof value.capturedAt === "number" &&
    typeof value.expiresAt === "number" &&
    typeof value.snapshotSha256 === "string" &&
    value.provenance.source === "ide_bridge" &&
    value.provenance.trust === "untrusted_external_data"
  );
}

export async function getIdeBridgeStatus(): Promise<IdeBridgeNativeStatus> {
  if (!isTauriRuntime()) {
    return STOPPED_STATUS;
  }
  return parseStatus(await invoke<unknown>("ide_bridge_status"));
}

export async function startIdeBridge(): Promise<IdeBridgeNativeStatus> {
  if (!isTauriRuntime()) {
    return STOPPED_STATUS;
  }
  return parseStatus(await invoke<unknown>("ide_bridge_start"));
}

export async function stopIdeBridge(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("ide_bridge_stop");
}

export async function getIdeBridgeSnapshot(): Promise<IdeWorkspaceSnapshot | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const raw = await invoke<unknown>("ide_bridge_snapshot");
  if (!looksLikeSnapshot(raw)) {
    return null;
  }
  try {
    const shape = validateIdeWorkspaceSnapshotShape(raw);
    if (!shape.ok) {
      return null;
    }
    const result = await validateSnapshotIntegrity(shape.value, Date.now());
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function subscribeIdeBridgeUpdates(
  listener: (event: IdeBridgeUpdate) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined;
  }
  return listen<unknown>("ari://ide-bridge-updated", ({ payload }) => {
    if (!isRecord(payload) || payload.protocolVersion !== 1) {
      return;
    }
    const client = payload.client;
    listener({
      protocolVersion: 1,
      type: optionalString(payload.type) ?? "updated",
      workspaceId: optionalString(payload.workspaceId),
      revision: optionalNumber(payload.revision),
      receivedAt: optionalNumber(payload.receivedAt) ?? Date.now(),
      client:
        client === "vscode" ||
        client === "jetbrains" ||
        client === "terminal" ||
        client === "test"
          ? client
          : undefined,
      clientInstanceId: optionalString(payload.clientInstanceId),
    });
  });
}
