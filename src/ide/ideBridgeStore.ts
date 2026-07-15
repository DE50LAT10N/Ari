import {
  IDE_BRIDGE_PROTOCOL_VERSION,
  type IdeAckMessage,
  type IdeClientKind,
  type IdeClientMessage,
  type IdeErrorCode,
  type IdeErrorMessage,
  type IdePairingSession,
  type IdeServerMessage,
  type IdeWelcomeMessage,
  type IdeWorkspaceSnapshot,
} from "./protocol";
import {
  IDE_MAX_CLOCK_SKEW_MS,
  parseIdeClientMessage,
  validateSnapshotIntegrity,
} from "./snapshotValidation";

export type IdeBridgeStoreState = {
  connection: "waiting" | "paired" | "expired";
  sessionId: string;
  client?: IdeClientKind;
  clientInstanceId?: string;
  lastSequence: number;
  snapshot?: IdeWorkspaceSnapshot;
  lastEventAt?: number;
};

export type IdeBridgeStoreOptions = {
  now?: () => number;
  createId?: () => string;
};

type StoreListener = (state: Readonly<IdeBridgeStoreState>) => void;

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function immutableSnapshot(snapshot: IdeWorkspaceSnapshot): IdeWorkspaceSnapshot {
  return structuredClone(snapshot);
}

export class IdeBridgeStore {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly listeners = new Set<StoreListener>();
  private state: IdeBridgeStoreState;

  constructor(
    private readonly session: IdePairingSession,
    options: IdeBridgeStoreOptions = {},
  ) {
    if (session.token.length < 32) {
      throw new Error("IDE pairing token must contain at least 32 characters");
    }
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.state = {
      connection: "waiting",
      sessionId: session.sessionId,
      lastSequence: -1,
    };
  }

  getState(): Readonly<IdeBridgeStoreState> {
    return this.state;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getFreshSnapshot(options: {
    workspaceId?: string;
    maxAgeMs?: number;
  } = {}): IdeWorkspaceSnapshot | undefined {
    const snapshot = this.state.snapshot;
    if (!snapshot) return undefined;
    const now = this.now();
    if (snapshot.expiresAt <= now) return undefined;
    if (options.workspaceId && snapshot.workspaceId !== options.workspaceId) return undefined;
    if (options.maxAgeMs !== undefined && now - snapshot.capturedAt > options.maxAgeMs) {
      return undefined;
    }
    return immutableSnapshot(snapshot);
  }

  async accept(rawMessage: unknown): Promise<IdeServerMessage> {
    const parsed = parseIdeClientMessage(rawMessage);
    if (!parsed.ok) {
      return this.error(undefined, parsed.code, parsed.message, false);
    }
    const message = parsed.value;
    const now = this.now();
    if (this.session.expiresAt <= now) {
      this.updateState({ ...this.state, connection: "expired" });
      return this.error(message.messageId, "SESSION_EXPIRED", "IDE pairing session expired", false);
    }
    if (
      !constantTimeEqual(message.auth.sessionId, this.session.sessionId) ||
      !constantTimeEqual(message.auth.token, this.session.token)
    ) {
      return this.error(message.messageId, "UNAUTHORIZED", "IDE bridge credentials were rejected", false);
    }
    if (message.sentAt > now + IDE_MAX_CLOCK_SKEW_MS || message.sentAt < now - 5 * 60_000) {
      return this.error(message.messageId, "REPLAYED_MESSAGE", "IDE message timestamp is stale", false);
    }
    if (message.sequence <= this.state.lastSequence) {
      return this.error(message.messageId, "REPLAYED_MESSAGE", "IDE message sequence was already used", false);
    }
    if (message.type === "hello") return this.acceptHello(message, now);
    if (
      this.state.connection !== "paired" ||
      !this.state.clientInstanceId ||
      message.type === "snapshot.publish" &&
        message.snapshot.provenance.clientInstanceId !== this.state.clientInstanceId
    ) {
      return this.error(message.messageId, "CLIENT_NOT_PAIRED", "Send an authenticated hello first", true);
    }

    if (message.type === "snapshot.publish") {
      const accepted = await this.acceptSnapshot(message.snapshot, message.messageId);
      if (accepted.type === "error") return accepted;
    } else if (message.snapshot) {
      if (
        message.event.workspaceId !== message.snapshot.workspaceId ||
        message.event.revision !== message.snapshot.revision
      ) {
        return this.error(
          message.messageId,
          "INVALID_SNAPSHOT",
          "Event and snapshot revisions do not match",
          false,
        );
      }
      const accepted = await this.acceptSnapshot(message.snapshot, message.messageId);
      if (accepted.type === "error") return accepted;
    } else {
      if (message.event.kind !== "workspace.closed") {
        return this.error(
          message.messageId,
          "INVALID_SNAPSHOT",
          "IDE state events require a complete snapshot",
          true,
        );
      }
      const current = this.state.snapshot;
      if (
        current &&
        (message.event.workspaceId !== current.workspaceId ||
          message.event.revision !== current.revision)
      ) {
        return this.error(
          message.messageId,
          "STALE_REVISION",
          "Workspace close event does not match the accepted snapshot",
          true,
          current.revision,
        );
      }
      this.updateState({ ...this.state, snapshot: undefined });
    }

    this.updateState({
      ...this.state,
      lastSequence: message.sequence,
      lastEventAt: now,
    });
    return this.ack(message, message.type === "event.publish" ? message.event.revision : message.snapshot.revision);
  }

  private acceptHello(
    message: Extract<IdeClientMessage, { type: "hello" }>,
    now: number,
  ): IdeWelcomeMessage | IdeErrorMessage {
    if (this.session.expectedClient && message.client !== this.session.expectedClient) {
      return this.error(message.messageId, "UNAUTHORIZED", "Unexpected IDE client type", false);
    }
    if (
      this.state.connection === "paired" &&
      this.state.clientInstanceId !== message.clientInstanceId
    ) {
      return this.error(message.messageId, "UNAUTHORIZED", "Pairing session is already in use", false);
    }
    this.updateState({
      ...this.state,
      connection: "paired",
      client: message.client,
      clientInstanceId: message.clientInstanceId,
      lastSequence: message.sequence,
      lastEventAt: now,
    });
    return {
      protocolVersion: IDE_BRIDGE_PROTOCOL_VERSION,
      type: "welcome",
      messageId: this.createId(),
      replyTo: message.messageId,
      sentAt: now,
      sessionId: this.session.sessionId,
      expiresAt: this.session.expiresAt,
      acceptedClientInstanceId: message.clientInstanceId,
    };
  }

  private async acceptSnapshot(
    snapshot: IdeWorkspaceSnapshot,
    replyTo: string,
  ): Promise<IdeAckMessage | IdeErrorMessage> {
    if (
      snapshot.provenance.client !== this.state.client ||
      snapshot.provenance.clientInstanceId !== this.state.clientInstanceId ||
      snapshot.provenance.source !== "ide_bridge" ||
      snapshot.provenance.trust !== "untrusted_external_data"
    ) {
      return this.error(replyTo, "INVALID_SNAPSHOT", "Snapshot provenance is invalid", false);
    }
    const current = this.state.snapshot;
    if (current && current.workspaceId === snapshot.workspaceId) {
      if (snapshot.revision <= current.revision) {
        return this.error(
          replyTo,
          "STALE_REVISION",
          "Snapshot revision is stale",
          true,
          current.revision,
        );
      }
      if (snapshot.parentRevision !== current.revision) {
        return this.error(
          replyTo,
          "STALE_REVISION",
          "Snapshot does not extend the accepted revision",
          true,
          current.revision,
        );
      }
    }
    const integrity = await validateSnapshotIntegrity(snapshot, this.now());
    if (!integrity.ok) {
      return this.error(replyTo, integrity.code, integrity.message, false);
    }
    this.updateState({ ...this.state, snapshot: immutableSnapshot(snapshot) });
    return this.ack(undefined, snapshot.revision, replyTo);
  }

  private ack(
    message?: IdeClientMessage,
    acceptedRevision?: number,
    replyTo?: string,
  ): IdeAckMessage {
    return {
      protocolVersion: IDE_BRIDGE_PROTOCOL_VERSION,
      type: "ack",
      messageId: this.createId(),
      replyTo: replyTo ?? message?.messageId,
      sentAt: this.now(),
      acceptedSequence: message?.sequence ?? this.state.lastSequence + 1,
      acceptedRevision,
    };
  }

  private error(
    replyTo: string | undefined,
    code: IdeErrorCode,
    message: string,
    retryable: boolean,
    expectedRevision?: number,
  ): IdeErrorMessage {
    return {
      protocolVersion: IDE_BRIDGE_PROTOCOL_VERSION,
      type: "error",
      messageId: this.createId(),
      replyTo,
      sentAt: this.now(),
      code,
      message,
      retryable,
      expectedRevision,
    };
  }

  private updateState(state: IdeBridgeStoreState): void {
    this.state = state;
    for (const listener of this.listeners) listener(this.state);
  }
}
