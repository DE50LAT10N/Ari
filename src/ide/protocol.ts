export const IDE_BRIDGE_PROTOCOL_VERSION = 1 as const;

export type IdeBridgeProtocolVersion = typeof IDE_BRIDGE_PROTOCOL_VERSION;

export type IdeClientKind = "vscode" | "jetbrains" | "terminal" | "test";

export type IdeProvenance = {
  source: "ide_bridge";
  client: IdeClientKind;
  clientInstanceId: string;
  collectedAt: number;
  trust: "untrusted_external_data";
};

export type IdeSharingPolicy = {
  shareActiveFile: boolean;
  shareSelection: boolean;
  shareUnsavedBuffers: boolean;
  shareDiagnostics: boolean;
  shareGitStatus: boolean;
  shareTestResults: boolean;
};

export type IdeTextPayload = {
  value: string;
  sha256: string;
  byteLength: number;
  truncatedAtSource?: boolean;
};

export type IdePosition = {
  line: number;
  character: number;
};

export type IdeRange = {
  start: IdePosition;
  end: IdePosition;
};

export type IdeSelection = {
  range: IdeRange;
  text?: IdeTextPayload;
};

export type IdeActiveEditor = {
  uri: string;
  languageId: string;
  documentVersion: number;
  isDirty: boolean;
  selection?: IdeSelection;
  unsavedBuffer?: IdeTextPayload;
};

export type IdeDiagnosticSeverity = "error" | "warning" | "information" | "hint";

export type IdeDiagnostic = {
  uri: string;
  range: IdeRange;
  severity: IdeDiagnosticSeverity;
  message: string;
  source?: string;
  code?: string;
};

export type IdeGitChange = {
  uri: string;
  status: string;
};

export type IdeGitSnapshot = {
  repositoryRootUri: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  changes: IdeGitChange[];
};

export type IdeTestResult = {
  id: string;
  label: string;
  status: "passed" | "failed" | "skipped" | "cancelled";
  completedAt: number;
  durationMs?: number;
  output?: IdeTextPayload;
};

export type IdeWorkspaceRoot = {
  uri: string;
  name: string;
};

export type IdeWorkspaceSnapshot = {
  workspaceId: string;
  projectId: string;
  roots: IdeWorkspaceRoot[];
  revision: number;
  parentRevision?: number;
  capturedAt: number;
  expiresAt: number;
  snapshotSha256: string;
  provenance: IdeProvenance;
  sharing: IdeSharingPolicy;
  activeEditor?: IdeActiveEditor;
  diagnostics?: IdeDiagnostic[];
  git?: IdeGitSnapshot[];
  recentTests?: IdeTestResult[];
};

export type IdeEventKind =
  | "workspace.opened"
  | "workspace.changed"
  | "activeEditor.changed"
  | "document.changed"
  | "selection.changed"
  | "diagnostics.changed"
  | "git.changed"
  | "testRun.finished"
  | "workspace.closed";

export type IdeBridgeCapabilities = {
  snapshots: true;
  activeFile: boolean;
  selections: boolean;
  unsavedBuffers: boolean;
  diagnostics: boolean;
  git: boolean;
  tests: boolean;
};

export type IdeBridgeAuth = {
  sessionId: string;
  token: string;
};

type IdeClientEnvelopeBase = {
  protocolVersion: IdeBridgeProtocolVersion;
  messageId: string;
  sequence: number;
  sentAt: number;
  auth: IdeBridgeAuth;
};

export type IdeHelloMessage = IdeClientEnvelopeBase & {
  type: "hello";
  client: IdeClientKind;
  clientInstanceId: string;
  capabilities: IdeBridgeCapabilities;
};

export type IdeSnapshotMessage = IdeClientEnvelopeBase & {
  type: "snapshot.publish";
  snapshot: IdeWorkspaceSnapshot;
};

export type IdeEventMessage = IdeClientEnvelopeBase & {
  type: "event.publish";
  event: {
    kind: IdeEventKind;
    workspaceId: string;
    revision: number;
    uri?: string;
  };
  snapshot?: IdeWorkspaceSnapshot;
};

export type IdeClientMessage =
  | IdeHelloMessage
  | IdeSnapshotMessage
  | IdeEventMessage;

type IdeServerEnvelopeBase = {
  protocolVersion: IdeBridgeProtocolVersion;
  messageId: string;
  replyTo?: string;
  sentAt: number;
};

export type IdeWelcomeMessage = IdeServerEnvelopeBase & {
  type: "welcome";
  sessionId: string;
  expiresAt: number;
  acceptedClientInstanceId: string;
};

export type IdeAckMessage = IdeServerEnvelopeBase & {
  type: "ack";
  acceptedSequence: number;
  acceptedRevision?: number;
};

export type IdeErrorCode =
  | "INVALID_MESSAGE"
  | "UNAUTHORIZED"
  | "SESSION_EXPIRED"
  | "CLIENT_NOT_PAIRED"
  | "REPLAYED_MESSAGE"
  | "STALE_REVISION"
  | "INVALID_SNAPSHOT"
  | "PAYLOAD_TOO_LARGE";

export type IdeErrorMessage = IdeServerEnvelopeBase & {
  type: "error";
  code: IdeErrorCode;
  message: string;
  retryable: boolean;
  expectedRevision?: number;
};

export type IdeServerMessage = IdeWelcomeMessage | IdeAckMessage | IdeErrorMessage;

export type IdePairingSession = {
  sessionId: string;
  token: string;
  expiresAt: number;
  expectedClient?: IdeClientKind;
};
