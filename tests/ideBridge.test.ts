import { describe, expect, it } from "vitest";
import {
  createIdeTextPayload,
  createSnapshotHash,
} from "../src/ide/contentHash";
import {
  IdeBridgeService,
  InMemoryIdeBridgeTransport,
} from "../src/ide/ideBridgeService";
import { IdeBridgeStore } from "../src/ide/ideBridgeStore";
import { createIdePairingSession } from "../src/ide/pairing";
import { isIdeAdvisorSnapshotFresh } from "../src/ide/snapshotFreshness";
import { validateIdeWorkspaceSnapshotShape } from "../src/ide/snapshotValidation";
import {
  IDE_BRIDGE_PROTOCOL_VERSION,
  type IdeClientMessage,
  type IdePairingSession,
  type IdeWorkspaceSnapshot,
} from "../src/ide/protocol";

const NOW = 1_800_000_000_000;
const TOKEN = "a".repeat(48);

const session: IdePairingSession = {
  sessionId: "pairing-1",
  token: TOKEN,
  expiresAt: NOW + 60_000,
  expectedClient: "vscode",
};

async function createSnapshot(
  revision = 1,
  parentRevision?: number,
): Promise<IdeWorkspaceSnapshot> {
  const selection = await createIdeTextPayload("const answer = 42;");
  const snapshot: IdeWorkspaceSnapshot = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    roots: [{ uri: "file:///repo", name: "repo" }],
    revision,
    parentRevision,
    capturedAt: NOW,
    expiresAt: NOW + 45_000,
    snapshotSha256: "0".repeat(64),
    provenance: {
      source: "ide_bridge",
      client: "vscode",
      clientInstanceId: "vscode-1",
      collectedAt: NOW,
      trust: "untrusted_external_data",
    },
    sharing: {
      shareActiveFile: true,
      shareSelection: true,
      shareUnsavedBuffers: false,
      shareDiagnostics: false,
      shareGitStatus: false,
      shareTestResults: false,
    },
    activeEditor: {
      uri: "file:///repo/src/main.ts",
      languageId: "typescript",
      documentVersion: 3,
      isDirty: false,
      selection: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 18 },
        },
        text: selection,
      },
    },
  };
  snapshot.snapshotSha256 = await createSnapshotHash(snapshot);
  return snapshot;
}

function hello(sequence = 1, token = TOKEN): IdeClientMessage {
  return {
    protocolVersion: IDE_BRIDGE_PROTOCOL_VERSION,
    type: "hello",
    messageId: `message-${sequence}`,
    sequence,
    sentAt: NOW,
    auth: { sessionId: session.sessionId, token },
    client: "vscode",
    clientInstanceId: "vscode-1",
    capabilities: {
      snapshots: true,
      activeFile: true,
      selections: true,
      unsavedBuffers: true,
      diagnostics: true,
      git: true,
      tests: true,
    },
  };
}

async function snapshotMessage(
  sequence: number,
  revision = 1,
  parentRevision?: number,
): Promise<IdeClientMessage> {
  return {
    protocolVersion: IDE_BRIDGE_PROTOCOL_VERSION,
    type: "snapshot.publish",
    messageId: `message-${sequence}`,
    sequence,
    sentAt: NOW,
    auth: { sessionId: session.sessionId, token: TOKEN },
    snapshot: await createSnapshot(revision, parentRevision),
  };
}

describe("IdeBridgeStore", () => {
  it("creates short-lived, high-entropy pairing credentials", () => {
    const pairing = createIdePairingSession({
      now: NOW,
      ttlMs: 60_000,
      expectedClient: "vscode",
    });
    expect(pairing.sessionId).toBeTruthy();
    expect(pairing.token).toMatch(/^[a-f0-9]{64}$/);
    expect(pairing.expiresAt).toBe(NOW + 60_000);
    expect(pairing.expectedClient).toBe("vscode");
  });

  it("authenticates a client and accepts a revisioned snapshot", async () => {
    const store = new IdeBridgeStore(session, {
      now: () => NOW,
      createId: () => "server-message",
    });
    expect((await store.accept(hello())).type).toBe("welcome");
    const accepted = await store.accept(await snapshotMessage(2));
    expect(accepted.type).toBe("ack");
    expect(store.getFreshSnapshot()?.revision).toBe(1);
    expect(store.getState().clientInstanceId).toBe("vscode-1");
  });

  it("rejects invalid credentials without pairing the client", async () => {
    const store = new IdeBridgeStore(session, { now: () => NOW });
    const response = await store.accept(hello(1, "b".repeat(48)));
    expect(response).toMatchObject({ type: "error", code: "UNAUTHORIZED" });
    expect(store.getState().connection).toBe("waiting");
  });

  it("rejects replayed messages and non-contiguous snapshot revisions", async () => {
    const store = new IdeBridgeStore(session, { now: () => NOW });
    await store.accept(hello());
    await store.accept(await snapshotMessage(2));

    const replay = await store.accept(await snapshotMessage(2));
    expect(replay).toMatchObject({ type: "error", code: "REPLAYED_MESSAGE" });

    const gap = await store.accept(await snapshotMessage(3, 3, 2));
    expect(gap).toMatchObject({ type: "error", code: "STALE_REVISION" });
  });

  it("rejects content that bypasses the declared privacy policy", async () => {
    const store = new IdeBridgeStore(session, { now: () => NOW });
    await store.accept(hello());
    const message = await snapshotMessage(2);
    if (message.type !== "snapshot.publish") throw new Error("unexpected fixture");
    message.snapshot.sharing.shareSelection = false;
    message.snapshot.snapshotSha256 = await createSnapshotHash(message.snapshot);

    const response = await store.accept(message);
    expect(response).toMatchObject({ type: "error", code: "INVALID_SNAPSHOT" });
  });

  it("rejects malformed nested snapshot ranges before integrity checks", async () => {
    const malformed = await createSnapshot();
    const range = malformed.activeEditor?.selection?.range;
    if (!range) throw new Error("missing fixture range");
    range.start = { line: 4, character: 0 };
    range.end = { line: 3, character: 20 };

    expect(validateIdeWorkspaceSnapshotShape(malformed)).toMatchObject({
      ok: false,
      code: "INVALID_SNAPSHOT",
      message: "Active editor payload is malformed",
    });
  });

  it("rejects selection consent without active-file consent", async () => {
    const malformed = await createSnapshot();
    malformed.activeEditor = undefined;
    malformed.sharing.shareActiveFile = false;
    malformed.sharing.shareSelection = true;

    expect(validateIdeWorkspaceSnapshotShape(malformed)).toMatchObject({
      ok: false,
      code: "INVALID_SNAPSHOT",
    });
  });

  it("treats expired, old, and far-future advisor snapshots as stale", async () => {
    const snapshot = await createSnapshot();
    snapshot.expiresAt = NOW + 120_000;

    expect(isIdeAdvisorSnapshotFresh(snapshot, NOW + 30_000)).toBe(true);
    expect(isIdeAdvisorSnapshotFresh(snapshot, NOW + 60_001)).toBe(false);
    expect(isIdeAdvisorSnapshotFresh(snapshot, NOW + 120_000)).toBe(false);

    snapshot.capturedAt = NOW + 30_001;
    snapshot.expiresAt = NOW + 60_000;
    expect(isIdeAdvisorSnapshotFresh(snapshot, NOW)).toBe(false);
  });

  it("detects text tampering even when the snapshot hash is recomputed", async () => {
    const store = new IdeBridgeStore(session, { now: () => NOW });
    await store.accept(hello());
    const message = await snapshotMessage(2);
    if (message.type !== "snapshot.publish") throw new Error("unexpected fixture");
    const text = message.snapshot.activeEditor?.selection?.text;
    if (!text) throw new Error("missing fixture text");
    text.value = "tampered";
    message.snapshot.snapshotSha256 = await createSnapshotHash(message.snapshot);

    const response = await store.accept(message);
    expect(response).toMatchObject({ type: "error", code: "INVALID_SNAPSHOT" });
  });

  it("drops IDE state when the paired workspace closes", async () => {
    const store = new IdeBridgeStore(session, { now: () => NOW });
    await store.accept(hello());
    await store.accept(await snapshotMessage(2));
    const closed: IdeClientMessage = {
      protocolVersion: IDE_BRIDGE_PROTOCOL_VERSION,
      type: "event.publish",
      messageId: "message-3",
      sequence: 3,
      sentAt: NOW,
      auth: { sessionId: session.sessionId, token: TOKEN },
      event: {
        kind: "workspace.closed",
        workspaceId: "workspace-1",
        revision: 1,
      },
    };
    expect((await store.accept(closed)).type).toBe("ack");
    expect(store.getFreshSnapshot()).toBeUndefined();
  });
});

describe("IdeBridgeService", () => {
  it("serializes transport messages through the store", async () => {
    const store = new IdeBridgeStore(session, { now: () => NOW });
    const transport = new InMemoryIdeBridgeTransport();
    const service = new IdeBridgeService(store, transport);
    service.start();
    transport.deliver(hello());
    transport.deliver(await snapshotMessage(2));
    await service.idle();

    expect(transport.sent.map((message) => message.type)).toEqual(["welcome", "ack"]);
    expect(store.getFreshSnapshot()?.workspaceId).toBe("workspace-1");
    service.stop();
  });
});
