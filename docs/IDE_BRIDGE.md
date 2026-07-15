# IDE Bridge and Engineering Mentor context

Status: implemented end to end: native loopback host, consent lifecycle, VS Code client, integrity/replay validation, runtime prompt integration, and mentor context UI.

> Experimental profile (current build): `EXPERIMENTAL_UNRESTRICTED_CONTEXT` is
> enabled. Active file, selection, unsaved buffer, diagnostics, Git and tests are
> always shared with the local Ari session; persisted privacy toggles and process
> allowlists do not suppress evidence. Loopback authentication, hashes, TTL,
> replay protection, secret redaction and payload bounds remain enabled.

## Design goals

- read-only IDE advisor by default;
- no screen-title parsing as an IDE source of truth;
- immutable project snapshots with monotonic revisions;
- protocol support for active file, selection, unsaved buffers, diagnostics, Git, and tests (all forced on in the current experiment);
- short-lived authenticated pairing restricted to loopback;
- content hashes, provenance, expiry, replay protection, and hard context budgets;
- all IDE content is `untrusted_external_data`, never a system instruction.

## Runtime topology

```text
VS Code extension
  └─ POST http://127.0.0.1:<ephemeral-port>/ide/v1/messages
      └─ native Tauri loopback host
          └─ revisioned snapshot cache + update event
              └─ frontend integrity validation
                  └─ buildEngineeringMentorContext
                      └─ Prompt Compiler as untrusted runtime evidence
```

`src/ide/protocol.ts` is the authoritative wire contract. The native host validates authentication, timestamps, replay sequence, client identity, privacy flags, revision continuity, TTL, and payload bounds. Before prompt use, the frontend independently verifies every text SHA-256 and the canonical snapshot SHA-256.

`IdeBridgeStore` and `IdeBridgeService` provide the same protocol/state rules for tests and alternative transports. `InMemoryIdeBridgeTransport` is available for non-native development.

## Native HTTP contract

The native host must bind a randomly selected port on `127.0.0.1` only. Do not bind `0.0.0.0`, expose LAN access, follow proxy settings, or accept a hostname supplied by the extension.

### `POST /ide/v1/messages`

- Request `Content-Type`: `application/json`.
- Optional diagnostic header: `X-Ari-Ide-Protocol: 1`.
- Maximum body: 2 MiB.
- Body: one `IdeClientMessage` envelope.
- Success and protocol rejection: HTTP 200 with one `IdeServerMessage` JSON body.
- Malformed HTTP/body-too-large: HTTP 400/413 without echoing request data.
- Processing must remain ordered for a session. A later message may not overtake an earlier revision.

### `GET /ide/v1/health`

May return only:

```json
{ "status": "ready", "protocolVersion": 1 }
```

It must not reveal session IDs, tokens, workspace paths, client state, or snapshots.

### Pairing connection file

After explicit IDE Advisor consent, the desktop app generates a 256-bit OS-random token and a separate session ID. The pairing file expires after two minutes. After an authenticated `hello`, it is deleted and the same credential continues only in memory/VS Code `SecretStorage` for an eight-hour local session. Disabling IDE Advisor invalidates that session and clears its snapshot.

```json
{
  "protocolVersion": 1,
  "endpoint": "http://127.0.0.1:37891/ide/v1/messages",
  "sessionId": "8eb9...",
  "token": "64-lowercase-hex-characters",
  "expiresAt": 1800000120000
}
```

Write the file with user-only permissions, avoid predictable shared directories, and delete it after successful pairing or expiry. Never put the token in a URL, log, process argument, analytics event, or error message. The extension moves the token into VS Code `SecretStorage` after the user explicitly selects the file.

## Wire envelopes

Every client message has:

```ts
{
  protocolVersion: 1;
  messageId: string;
  sequence: number;
  sentAt: number;
  auth: { sessionId: string; token: string };
  type: "hello" | "snapshot.publish" | "event.publish";
  // type-specific payload
}
```

The first message must be `hello`. It binds the pairing session to one client instance. Later messages with a reused sequence, another client ID, invalid token, or stale timestamp are rejected.

Server messages are:

- `welcome`: pairing accepted, session expiry returned;
- `ack`: message sequence and optional snapshot revision accepted;
- `error`: stable error code, retryability, and optionally the currently expected revision.

## Snapshot model

`IdeWorkspaceSnapshot` contains:

- stable `workspaceId` and `projectId` derived from workspace roots;
- root URI metadata;
- `revision` and `parentRevision`;
- `capturedAt`, `expiresAt`, and canonical `snapshotSha256`;
- client provenance and the exact sharing policy used;
- optional active editor, selection, unsaved buffer, diagnostics, Git state, and recent test results.

Selection, buffers, and test output use `IdeTextPayload`:

```ts
{
  value: string;
  sha256: string;
  byteLength: number;
  truncatedAtSource?: boolean;
}
```

The hash is an integrity/change-tracking primitive, not authorization. Authorization is the pairing session plus native loopback boundary.

## VS Code events

The client debounces and publishes fresh snapshots for:

| Event | Source |
|---|---|
| `workspace.changed` | workspace folders or sharing settings |
| `workspace.closed` | the last workspace folder is closed; clears the cached snapshot immediately |
| `activeEditor.changed` | active text editor |
| `document.changed` | document edit |
| `selection.changed` | editor selection |
| `diagnostics.changed` | VS Code diagnostics |
| `git.changed` | built-in Git repository state |
| `testRun.finished` | explicit test-adapter command |

IDE context sharing is enabled by default for the proactive advisor profile. In the experimental 0.1.2 extension, `shareUnsavedBuffers` carries the complete active editor buffer for both saved and dirty files; `isDirty` distinguishes them. Every source remains independently configurable; `shareSelection` and `shareUnsavedBuffers` are forced off whenever `shareActiveFile` is disabled.
Event URIs follow the same consent policy: editor/document/selection URIs require active-file sharing, diagnostics URIs require diagnostics sharing, and Git URIs require Git-status sharing. Otherwise the event omits `uri`.

## Engineering Mentor context

`buildEngineeringMentorContext(snapshot, options)` converts a fresh accepted snapshot into bounded evidence. Current priority is:

1. workspace and active-editor metadata;
2. current selection;
3. diagnostics;
4. failed/recent tests;
5. unsaved buffer;
6. Git status.

Each evidence item includes its source, workspace, snapshot revision, expiry, content hash, and `trust: "untrusted_external_data"`. The builder never converts IDE content into instructions. Expired snapshots yield no evidence, and the sum of evidence content cannot exceed `maxContentChars`.

## Desktop integration

- `ide_bridge_start` and `ide_bridge_stop` tie the native listener to explicit `ideAdvisorEnabled` consent. The listener is never started during application bootstrap.
- `ide_bridge_status` exposes waiting/paired state to the trusted webview; `ide_bridge_snapshot` returns only the latest accepted snapshot.
- `src/platform/ideBridgeNative.ts` subscribes to `ari://ide-bridge-updated`, revalidates snapshot hashes/TTL in the frontend, and rejects malformed data before prompt use.
- The VS Code client automatically consumes a fresh connection file from `%APPDATA%\\app.ari.desktop` when `autoConnect` is enabled; manual file selection remains available for recovery.
- The chat header displays connection state and a compact active-file/revision/diagnostics strip. Clicking the waiting `IDE` badge copies the pairing-file path.
- `buildReplyContext` accepts only a snapshot newer than 60 seconds, creates bounded Engineering Mentor evidence, and sends it through the runtime-context message. It never enters the system policy.
- Mentor authorization remains separate from sharing: default modes may explain, review, debug, compare architecture, or teach, but may not edit files or run commands.

## Run the VS Code client

```powershell
npm ci --prefix ide-extensions/vscode
npm run ide:check
npm run ide:compile
```

Open `ide-extensions/vscode` in VS Code and press `F5` using **Run Ari IDE Advisor**. In Ari, enable **IDE Advisor**, click the `IDE` badge, then run **Ari: Pair IDE Advisor from Connection File** in the Extension Development Host. Optional sharing sources remain disabled until enabled under **Settings → Ari IDE Advisor**.
