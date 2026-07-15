import {
  verifyIdeTextPayload,
  verifySnapshotHash,
} from "./contentHash";
import {
  IDE_BRIDGE_PROTOCOL_VERSION,
  type IdeClientMessage,
  type IdeErrorCode,
  type IdeTextPayload,
  type IdeWorkspaceSnapshot,
} from "./protocol";

export const IDE_MAX_WIRE_BYTES = 2 * 1024 * 1024;
export const IDE_MAX_SNAPSHOT_TTL_MS = 5 * 60_000;
export const IDE_MAX_CLOCK_SKEW_MS = 30_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type IdeValidationFailure = {
  ok: false;
  code: IdeErrorCode;
  message: string;
};

export type IdeValidationSuccess<T> = {
  ok: true;
  value: T;
};

export type IdeValidationResult<T> = IdeValidationSuccess<T> | IdeValidationFailure;

function failure(code: IdeErrorCode, message: string): IdeValidationFailure {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength = 2048): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPosition(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.line) &&
    isNonNegativeInteger(value.character)
  );
}

function isRange(value: unknown): boolean {
  if (!isRecord(value) || !isPosition(value.start) || !isPosition(value.end)) {
    return false;
  }
  const start = value.start as { line: number; character: number };
  const end = value.end as { line: number; character: number };
  return (
    start.line < end.line ||
    (start.line === end.line && start.character <= end.character)
  );
}

function isTextPayloadShape(value: unknown): value is IdeTextPayload {
  return (
    isRecord(value) &&
    typeof value.value === "string" &&
    value.value.length <= IDE_MAX_WIRE_BYTES &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256) &&
    isNonNegativeInteger(value.byteLength) &&
    value.byteLength <= IDE_MAX_WIRE_BYTES &&
    (value.truncatedAtSource === undefined || typeof value.truncatedAtSource === "boolean")
  );
}

function isActiveEditorShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.uri, 4096) ||
    !isNonEmptyString(value.languageId, 256) ||
    !isNonNegativeInteger(value.documentVersion) ||
    typeof value.isDirty !== "boolean"
  ) {
    return false;
  }
  if (value.selection !== undefined) {
    if (!isRecord(value.selection) || !isRange(value.selection.range)) return false;
    if (value.selection.text !== undefined && !isTextPayloadShape(value.selection.text)) return false;
  }
  return value.unsavedBuffer === undefined || isTextPayloadShape(value.unsavedBuffer);
}

function isDiagnosticShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.uri, 4096) &&
    isRange(value.range) &&
    ["error", "warning", "information", "hint"].includes(String(value.severity)) &&
    isNonEmptyString(value.message, 4_000) &&
    (value.source === undefined || isNonEmptyString(value.source, 200)) &&
    (value.code === undefined || isNonEmptyString(value.code, 200))
  );
}

function isGitShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.repositoryRootUri, 4096) &&
    (value.branch === undefined || isNonEmptyString(value.branch, 512)) &&
    (value.head === undefined || isNonEmptyString(value.head, 512)) &&
    typeof value.dirty === "boolean" &&
    Array.isArray(value.changes) &&
    value.changes.every(
      (change) =>
        isRecord(change) &&
        isNonEmptyString(change.uri, 4096) &&
        isNonEmptyString(change.status, 256),
    )
  );
}

function isTestShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id, 512) &&
    isNonEmptyString(value.label, 500) &&
    ["passed", "failed", "skipped", "cancelled"].includes(String(value.status)) &&
    isFiniteTimestamp(value.completedAt) &&
    (value.durationMs === undefined ||
      (typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0)) &&
    (value.output === undefined || isTextPayloadShape(value.output))
  );
}

function collectTextPayloads(snapshot: IdeWorkspaceSnapshot): IdeTextPayload[] {
  const payloads: IdeTextPayload[] = [];
  const selectionText = snapshot.activeEditor?.selection?.text;
  const unsavedBuffer = snapshot.activeEditor?.unsavedBuffer;
  if (selectionText) payloads.push(selectionText);
  if (unsavedBuffer) payloads.push(unsavedBuffer);
  for (const test of snapshot.recentTests ?? []) {
    if (test.output) payloads.push(test.output);
  }
  return payloads;
}

export function validateIdeWorkspaceSnapshotShape(
  value: unknown,
): IdeValidationResult<IdeWorkspaceSnapshot> {
  if (!isRecord(value)) return failure("INVALID_SNAPSHOT", "Snapshot must be an object");
  if (!isNonEmptyString(value.workspaceId, 256) || !isNonEmptyString(value.projectId, 256)) {
    return failure("INVALID_SNAPSHOT", "Snapshot requires workspaceId and projectId");
  }
  if (!Array.isArray(value.roots) || value.roots.length > 20) {
    return failure("INVALID_SNAPSHOT", "Snapshot roots must contain at most 20 entries");
  }
  if (
    !value.roots.every(
      (root) =>
        isRecord(root) &&
        isNonEmptyString(root.uri, 4096) &&
        isNonEmptyString(root.name, 256),
    )
  ) {
    return failure("INVALID_SNAPSHOT", "Workspace root is malformed");
  }
  if (!isNonNegativeInteger(value.revision) || value.revision === 0) {
    return failure("INVALID_SNAPSHOT", "Snapshot revision must be a positive integer");
  }
  if (
    value.parentRevision !== undefined &&
    (!isNonNegativeInteger(value.parentRevision) || value.parentRevision >= value.revision)
  ) {
    return failure("INVALID_SNAPSHOT", "parentRevision must precede revision");
  }
  if (!isFiniteTimestamp(value.capturedAt) || !isFiniteTimestamp(value.expiresAt)) {
    return failure("INVALID_SNAPSHOT", "Snapshot timestamps are malformed");
  }
  if (typeof value.snapshotSha256 !== "string" || !SHA256_PATTERN.test(value.snapshotSha256)) {
    return failure("INVALID_SNAPSHOT", "Snapshot hash is malformed");
  }
  if (!isRecord(value.provenance) || !isRecord(value.sharing)) {
    return failure("INVALID_SNAPSHOT", "Snapshot provenance and sharing policy are required");
  }
  if (
    value.provenance.source !== "ide_bridge" ||
    !["vscode", "jetbrains", "terminal", "test"].includes(String(value.provenance.client)) ||
    !isNonEmptyString(value.provenance.clientInstanceId, 256) ||
    !isFiniteTimestamp(value.provenance.collectedAt) ||
    value.provenance.trust !== "untrusted_external_data"
  ) {
    return failure("INVALID_SNAPSHOT", "Snapshot provenance is malformed");
  }
  const sharing = value.sharing;
  const sharingKeys = [
    "shareActiveFile",
    "shareSelection",
    "shareUnsavedBuffers",
    "shareDiagnostics",
    "shareGitStatus",
    "shareTestResults",
  ];
  if (!sharingKeys.every((key) => typeof sharing[key] === "boolean")) {
    return failure("INVALID_SNAPSHOT", "Sharing policy is malformed");
  }
  if (
    sharing.shareActiveFile === false &&
    (sharing.shareSelection === true || sharing.shareUnsavedBuffers === true)
  ) {
    return failure(
      "INVALID_SNAPSHOT",
      "Selection and unsaved-buffer sharing require active-file consent",
    );
  }

  const snapshot = value as IdeWorkspaceSnapshot;
  if (value.activeEditor !== undefined && !isActiveEditorShape(value.activeEditor)) {
    return failure("INVALID_SNAPSHOT", "Active editor payload is malformed");
  }
  if (
    value.diagnostics !== undefined &&
    (!Array.isArray(value.diagnostics) || !value.diagnostics.every(isDiagnosticShape))
  ) {
    return failure("INVALID_SNAPSHOT", "Diagnostics payload is malformed");
  }
  if (value.git !== undefined && (!Array.isArray(value.git) || !value.git.every(isGitShape))) {
    return failure("INVALID_SNAPSHOT", "Git payload is malformed");
  }
  if (
    value.recentTests !== undefined &&
    (!Array.isArray(value.recentTests) || !value.recentTests.every(isTestShape))
  ) {
    return failure("INVALID_SNAPSHOT", "Test result payload is malformed");
  }
  if (!snapshot.sharing.shareActiveFile && snapshot.activeEditor) {
    return failure("INVALID_SNAPSHOT", "Active editor was included without consent");
  }
  if (!snapshot.sharing.shareSelection && snapshot.activeEditor?.selection) {
    return failure("INVALID_SNAPSHOT", "Selection was included without consent");
  }
  if (!snapshot.sharing.shareUnsavedBuffers && snapshot.activeEditor?.unsavedBuffer) {
    return failure("INVALID_SNAPSHOT", "Unsaved buffer was included without consent");
  }
  if (!snapshot.sharing.shareDiagnostics && snapshot.diagnostics?.length) {
    return failure("INVALID_SNAPSHOT", "Diagnostics were included without consent");
  }
  if (!snapshot.sharing.shareGitStatus && snapshot.git?.length) {
    return failure("INVALID_SNAPSHOT", "Git data was included without consent");
  }
  if (!snapshot.sharing.shareTestResults && snapshot.recentTests?.length) {
    return failure("INVALID_SNAPSHOT", "Test results were included without consent");
  }
  if ((snapshot.diagnostics?.length ?? 0) > 500) {
    return failure("PAYLOAD_TOO_LARGE", "Snapshot contains more than 500 diagnostics");
  }
  if ((snapshot.recentTests?.length ?? 0) > 100) {
    return failure("PAYLOAD_TOO_LARGE", "Snapshot contains more than 100 test results");
  }
  if ((snapshot.git?.length ?? 0) > 20) {
    return failure("PAYLOAD_TOO_LARGE", "Snapshot contains more than 20 Git repositories");
  }
  if ((snapshot.git ?? []).some((repo) => repo.changes.length > 1_000)) {
    return failure("PAYLOAD_TOO_LARGE", "Git snapshot contains too many changes");
  }
  if (!collectTextPayloads(snapshot).every(isTextPayloadShape)) {
    return failure("INVALID_SNAPSHOT", "Text payload metadata is malformed");
  }
  return { ok: true, value: snapshot };
}

export function parseIdeClientMessage(value: unknown): IdeValidationResult<IdeClientMessage> {
  let wireBytes = 0;
  try {
    wireBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return failure("INVALID_MESSAGE", "Message is not JSON serializable");
  }
  if (wireBytes > IDE_MAX_WIRE_BYTES) {
    return failure("PAYLOAD_TOO_LARGE", "IDE bridge message exceeds the 2 MiB limit");
  }
  if (!isRecord(value)) return failure("INVALID_MESSAGE", "Message must be an object");
  if (value.protocolVersion !== IDE_BRIDGE_PROTOCOL_VERSION) {
    return failure("INVALID_MESSAGE", "Unsupported IDE bridge protocol version");
  }
  if (
    !isNonEmptyString(value.messageId, 256) ||
    !isNonNegativeInteger(value.sequence) ||
    !isFiniteTimestamp(value.sentAt) ||
    !isRecord(value.auth) ||
    !isNonEmptyString(value.auth.sessionId, 256) ||
    !isNonEmptyString(value.auth.token, 512)
  ) {
    return failure("INVALID_MESSAGE", "IDE bridge envelope is malformed");
  }
  if (value.type === "hello") {
    const capabilities = value.capabilities;
    if (
      !["vscode", "jetbrains", "terminal", "test"].includes(String(value.client)) ||
      !isNonEmptyString(value.clientInstanceId, 256) ||
      !isRecord(capabilities)
    ) {
      return failure("INVALID_MESSAGE", "Hello payload is malformed");
    }
    const capabilityKeys = [
      "snapshots",
      "activeFile",
      "selections",
      "unsavedBuffers",
      "diagnostics",
      "git",
      "tests",
    ];
    if (
      capabilities.snapshots !== true ||
      !capabilityKeys.every((key) => typeof capabilities[key] === "boolean")
    ) {
      return failure("INVALID_MESSAGE", "Hello capabilities are malformed");
    }
    return { ok: true, value: value as IdeClientMessage };
  }
  if (value.type === "snapshot.publish") {
    const snapshot = validateIdeWorkspaceSnapshotShape(value.snapshot);
    if (!snapshot.ok) return snapshot;
    return { ok: true, value: value as IdeClientMessage };
  }
  if (value.type === "event.publish") {
    const eventKinds = [
      "workspace.opened",
      "workspace.changed",
      "activeEditor.changed",
      "document.changed",
      "selection.changed",
      "diagnostics.changed",
      "git.changed",
      "testRun.finished",
      "workspace.closed",
    ];
    if (
      !isRecord(value.event) ||
      !eventKinds.includes(String(value.event.kind)) ||
      !isNonEmptyString(value.event.workspaceId, 256) ||
      !isNonNegativeInteger(value.event.revision) ||
      (value.event.uri !== undefined && !isNonEmptyString(value.event.uri, 4096))
    ) {
      return failure("INVALID_MESSAGE", "IDE event is malformed");
    }
    if (value.snapshot !== undefined) {
      const snapshot = validateIdeWorkspaceSnapshotShape(value.snapshot);
      if (!snapshot.ok) return snapshot;
    }
    return { ok: true, value: value as IdeClientMessage };
  }
  return failure("INVALID_MESSAGE", "Unknown IDE bridge message type");
}

export async function validateSnapshotIntegrity(
  snapshot: IdeWorkspaceSnapshot,
  now: number,
): Promise<IdeValidationResult<IdeWorkspaceSnapshot>> {
  if (snapshot.capturedAt > now + IDE_MAX_CLOCK_SKEW_MS) {
    return failure("INVALID_SNAPSHOT", "Snapshot timestamp is too far in the future");
  }
  if (Math.abs(snapshot.provenance.collectedAt - snapshot.capturedAt) > IDE_MAX_CLOCK_SKEW_MS) {
    return failure("INVALID_SNAPSHOT", "Snapshot provenance timestamp is inconsistent");
  }
  if (snapshot.expiresAt <= snapshot.capturedAt) {
    return failure("INVALID_SNAPSHOT", "Snapshot expiry must follow capture time");
  }
  if (snapshot.expiresAt - snapshot.capturedAt > IDE_MAX_SNAPSHOT_TTL_MS) {
    return failure("INVALID_SNAPSHOT", "Snapshot TTL exceeds five minutes");
  }
  if (snapshot.expiresAt <= now) {
    return failure("STALE_REVISION", "Snapshot has expired");
  }
  for (const payload of collectTextPayloads(snapshot)) {
    if (!(await verifyIdeTextPayload(payload))) {
      return failure("INVALID_SNAPSHOT", "Text payload hash or byte length is invalid");
    }
  }
  if (!(await verifySnapshotHash(snapshot))) {
    return failure("INVALID_SNAPSHOT", "Snapshot content hash is invalid");
  }
  return { ok: true, value: snapshot };
}
