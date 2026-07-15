import { createHash, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type {
  IdeBridgeAuth,
  IdeClientMessage,
  IdeDiagnostic,
  IdeDiagnosticSeverity,
  IdeEventKind,
  IdeGitSnapshot,
  IdeServerMessage,
  IdeSharingPolicy,
  IdeTestResult,
  IdeTextPayload,
  IdeWorkspaceSnapshot,
} from "../../../src/ide/protocol.js";

const PROTOCOL_VERSION = 1 as const;
const SECRET_TOKEN_KEY = "ari.ideBridge.pairingToken.v1";
const CLIENT_INSTANCE_KEY = "ari.ideBridge.clientInstanceId.v1";
const SEQUENCE_STATE_KEY = "ari.ideBridge.sequenceState.v1";
const SNAPSHOT_TTL_MS = 60_000;
const SNAPSHOT_HEARTBEAT_MS = 20_000;

type GitChange = { uri: vscode.Uri; status: number };
type GitRepository = {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string; commit?: string };
    workingTreeChanges: GitChange[];
    indexChanges: GitChange[];
    mergeChanges: GitChange[];
    onDidChange: vscode.Event<void>;
  };
};
type GitApi = {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
};
type GitExtension = { getAPI(version: 1): GitApi };

type PublishedTestResult = {
  id?: string;
  label: string;
  status: IdeTestResult["status"];
  durationMs?: number;
  output?: string;
};

type IdeConnectionFile = {
  protocolVersion: 1;
  endpoint: string;
  sessionId: string;
  token: string;
  expiresAt: number;
};

type PersistedSequenceState = {
  clientInstanceId: string;
  sessionIdSha256: string;
  sequence: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function snapshotHash(snapshot: IdeWorkspaceSnapshot): string {
  const hashable: Partial<IdeWorkspaceSnapshot> = { ...snapshot };
  delete hashable.snapshotSha256;
  return sha256(JSON.stringify(canonicalize(hashable)));
}

function textPayload(value: string, truncatedAtSource = false): IdeTextPayload {
  return {
    value,
    sha256: sha256(value),
    byteLength: Buffer.byteLength(value, "utf8"),
    truncatedAtSource: truncatedAtSource || undefined,
  };
}

function diagnosticSeverity(severity: vscode.DiagnosticSeverity): IdeDiagnosticSeverity {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "information";
    default:
      return "hint";
  }
}

function toRange(range: vscode.Range) {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function validateLoopbackEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  const allowedHosts = new Set(["127.0.0.1", "[::1]"]);
  if (url.protocol !== "http:" || !allowedHosts.has(url.hostname)) {
    throw new Error("Ari IDE Bridge only connects to a loopback HTTP endpoint");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Ari endpoint must not contain credentials, query parameters, or fragments");
  }
  if (!url.pathname.endsWith("/ide/v1/messages")) {
    throw new Error("Ari endpoint must end with /ide/v1/messages");
  }
  return url.toString();
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("ari.ideBridge");
}

function sharingPolicy(): IdeSharingPolicy {
  // Experimental build: expose every supported IDE evidence channel. The
  // loopback session authentication and snapshot integrity checks remain.
  return {
    shareActiveFile: true,
    shareSelection: true,
    shareUnsavedBuffers: true,
    shareDiagnostics: true,
    shareGitStatus: true,
    shareTestResults: true,
  };
}

function sharedEventUri(
  kind: IdeEventKind,
  uri: vscode.Uri | undefined,
  policy: IdeSharingPolicy,
): string | undefined {
  if (!uri) return undefined;
  if (
    kind === "activeEditor.changed" ||
    kind === "document.changed" ||
    kind === "selection.changed"
  ) {
    return policy.shareActiveFile ? uri.toString() : undefined;
  }
  if (kind === "diagnostics.changed") {
    return policy.shareDiagnostics ? uri.toString() : undefined;
  }
  if (kind === "git.changed") {
    return policy.shareGitStatus ? uri.toString() : undefined;
  }
  return undefined;
}

class AriIdeBridgeClient implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("Ari IDE Advisor", { log: true });
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  private readonly disposables: vscode.Disposable[] = [];
  private readonly gitDisposables: vscode.Disposable[] = [];
  private readonly clientInstanceId: string;
  private auth?: IdeBridgeAuth;
  private endpoint?: string;
  private connecting = false;
  private sequence = 0;
  private sequenceSessionHash?: string;
  private revision = 0;
  private workspaceId?: string;
  private paired = false;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private gitApi?: GitApi;
  private recentTests: IdeTestResult[] = [];
  private publishQueue = Promise.resolve();
  private publishGeneration = 0;
  private autoPairing = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.clientInstanceId =
      context.globalState.get<string>(CLIENT_INSTANCE_KEY) ?? `vscode-${randomUUID()}`;
    void context.globalState.update(CLIENT_INSTANCE_KEY, this.clientInstanceId);
    this.status.command = "ari.ideBridge.connect";
    this.setStatus("disconnected");
    this.status.show();
    this.registerCommands();
    this.registerEditorEvents();
    this.registerGitEvents();
    this.heartbeatTimer = setInterval(() => {
      if (!this.paired) return;
      this.output.info(`Snapshot heartbeat queued after revision ${this.revision}`);
      void this.publishSnapshot("workspace.changed").catch((error) => {
        this.output.error(error instanceof Error ? error.message : String(error));
      });
    }, SNAPSHOT_HEARTBEAT_MS);
  }

  async pair(): Promise<void> {
    const currentEndpoint = config().get(
      "endpoint",
      "http://127.0.0.1:37891/ide/v1/messages",
    );
    const endpoint = await vscode.window.showInputBox({
      title: "Ari IDE Advisor pairing",
      prompt: "Loopback endpoint shown by the Ari desktop app",
      value: currentEndpoint,
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          validateLoopbackEndpoint(value);
          return undefined;
        } catch (error) {
          return error instanceof Error ? error.message : "Invalid endpoint";
        }
      },
    });
    if (!endpoint) return;
    const sessionId = await vscode.window.showInputBox({
      title: "Ari IDE Advisor pairing",
      prompt: "Pairing session ID",
      ignoreFocusOut: true,
    });
    if (!sessionId) return;
    const token = await vscode.window.showInputBox({
      title: "Ari IDE Advisor pairing",
      prompt: "Short-lived pairing token",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.length >= 32 ? undefined : "Pairing token must contain at least 32 characters",
    });
    if (!token) return;

    await this.savePairing(validateLoopbackEndpoint(endpoint), sessionId, token);
    await this.connect();
  }

  async pairFromFile(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      title: "Select the connection file created by Ari",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { JSON: ["json"] },
      openLabel: "Pair with Ari",
    });
    const uri = selected?.[0];
    if (!uri) return;
    try {
      const parsed = await this.readConnectionFile(uri);
      await this.savePairing(parsed.endpoint, parsed.sessionId, parsed.token);
      await this.connect();
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : "Could not read Ari connection file",
      );
    }
  }

  async autoPairFromDefaultFile(): Promise<boolean> {
    if (this.autoPairing) return false;
    const appData = process.env.APPDATA;
    if (!appData) return false;
    const uri = vscode.Uri.joinPath(
      vscode.Uri.file(appData),
      "app.ari.desktop",
      "ide-bridge-connection.json",
    );
    this.autoPairing = true;
    try {
      const parsed = await this.readConnectionFile(uri);
      const currentSessionId = config().get<string>("sessionId", "");
      if (this.paired && parsed.sessionId === currentSessionId) return true;
      await this.savePairing(parsed.endpoint, parsed.sessionId, parsed.token);
      await this.connect();
      return true;
    } catch {
      return false;
    } finally {
      this.autoPairing = false;
    }
  }

  async connect(): Promise<void> {
    if (this.paired || this.connecting) return;
    const sessionId = config().get<string>("sessionId", "");
    const token = await this.context.secrets.get(SECRET_TOKEN_KEY);
    if (!sessionId || !token) {
      void vscode.window.showInformationMessage("Pair Ari IDE Advisor before connecting.", "Pair").then(
        async (choice) => {
          if (choice === "Pair") await this.pair();
        },
      );
      return;
    }
    let endpoint: string;
    try {
      endpoint = validateLoopbackEndpoint(config().get("endpoint", ""));
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Invalid Ari endpoint");
      return;
    }

    this.setStatus("connecting");
    this.connecting = true;
    this.auth = { sessionId, token };
    this.endpoint = endpoint;
    try {
      await this.restoreSequence(sessionId);
      await this.sendHello({ sessionId, token });
    } catch (error) {
      this.output.error(error instanceof Error ? error.message : String(error));
      this.paired = false;
      this.auth = undefined;
      this.endpoint = undefined;
      this.setStatus("disconnected");
      void vscode.window.showErrorMessage("Could not connect to the local Ari IDE Bridge.");
    } finally {
      this.connecting = false;
    }
  }

  disconnect(): void {
    this.paired = false;
    this.auth = undefined;
    this.endpoint = undefined;
    this.setStatus("disconnected");
  }

  async publishSnapshot(kind: IdeEventKind = "workspace.changed", uri?: vscode.Uri): Promise<void> {
    const generation = this.publishGeneration;
    const publish = this.publishQueue.then(async () => {
      // A stale-revision recovery deliberately abandons the old queued chain.
      // Jobs which were already waiting on that chain must not race the fresh
      // recovery snapshot after it has reset the revision cursor.
      if (generation !== this.publishGeneration) return;
      if (!this.paired) return;
      const snapshot = await this.buildSnapshot();
      if (!snapshot) return;
      this.output.info(`Publishing IDE snapshot revision ${snapshot.revision} (${kind})`);
      const eventMessage = await this.envelope({
        type: "event.publish",
        event: {
          kind,
          workspaceId: snapshot.workspaceId,
          revision: snapshot.revision,
          uri: sharedEventUri(kind, uri, snapshot.sharing),
        },
        snapshot,
      });
      await this.send(eventMessage);
    });
    this.publishQueue = publish.catch(() => undefined);
    await publish;
  }

  async publishTestResult(value: PublishedTestResult): Promise<void> {
    if (!value || typeof value.label !== "string") {
      throw new Error("Ari test result requires a label");
    }
    const policy = sharingPolicy();
    if (!policy.shareTestResults) return;
    const allowedStatuses: IdeTestResult["status"][] = [
      "passed",
      "failed",
      "skipped",
      "cancelled",
    ];
    if (!allowedStatuses.includes(value.status)) throw new Error("Invalid Ari test status");
    const output = value.output?.slice(0, 100_000);
    this.recentTests.unshift({
      id: value.id ?? randomUUID(),
      label: value.label.slice(0, 500),
      status: value.status,
      completedAt: Date.now(),
      durationMs: value.durationMs,
      output: output === undefined ? undefined : textPayload(output, output.length < value.output!.length),
    });
    this.recentTests = this.recentTests.slice(0, 20);
    await this.publishSnapshot("testRun.finished");
  }

  dispose(): void {
    this.disconnect();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const disposable of this.gitDisposables) disposable.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.status.dispose();
    this.output.dispose();
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand("ari.ideBridge.pair", () => this.pair()),
      vscode.commands.registerCommand("ari.ideBridge.pairFromFile", () => this.pairFromFile()),
      vscode.commands.registerCommand("ari.ideBridge.connect", () => this.connect()),
      vscode.commands.registerCommand("ari.ideBridge.disconnect", () => this.disconnect()),
      vscode.commands.registerCommand("ari.ideBridge.sendSnapshot", () => this.publishSnapshot()),
      vscode.commands.registerCommand(
        "ari.ideBridge.publishTestResult",
        (result: PublishedTestResult) => this.publishTestResult(result),
      ),
    );
  }

  private async savePairing(endpoint: string, sessionId: string, token: string): Promise<void> {
    const previousSessionId = config().get<string>("sessionId", "");
    this.disconnect();
    await config().update("endpoint", endpoint, true);
    await config().update("sessionId", sessionId, true);
    await this.context.secrets.store(SECRET_TOKEN_KEY, token);
    if (previousSessionId !== sessionId) {
      await this.resetSequence(sessionId);
    } else {
      await this.restoreSequence(sessionId);
    }
  }

  private registerEditorEvents(): void {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) =>
        this.schedule("activeEditor.changed", editor?.document.uri),
      ),
      vscode.window.onDidChangeTextEditorSelection((event) =>
        this.schedule("selection.changed", event.textEditor.document.uri),
      ),
      vscode.workspace.onDidChangeTextDocument((event) =>
        this.schedule("document.changed", event.document.uri),
      ),
      vscode.languages.onDidChangeDiagnostics((event) =>
        this.schedule("diagnostics.changed", event.uris[0]),
      ),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.handleWorkspaceFoldersChanged()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("ari.ideBridge")) this.schedule("workspace.changed");
      }),
    );
  }

  private registerGitEvents(): void {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) return;
    void extension.activate().then((git) => {
      this.gitApi = git.getAPI(1);
      const watch = (repository: GitRepository) => {
        this.gitDisposables.push(
          repository.state.onDidChange(() => this.schedule("git.changed", repository.rootUri)),
        );
      };
      this.gitApi.repositories.forEach(watch);
      this.gitDisposables.push(
        this.gitApi.onDidOpenRepository(watch),
        this.gitApi.onDidCloseRepository(() => this.schedule("git.changed")),
      );
    });
  }

  private schedule(kind: IdeEventKind, uri?: vscode.Uri): void {
    if (!this.paired) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const debounceMs = Math.max(100, Math.min(5_000, config().get("debounceMs", 350)));
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.publishSnapshot(kind, uri).catch((error) => {
        this.output.error(error instanceof Error ? error.message : String(error));
      });
    }, debounceMs);
  }

  private handleWorkspaceFoldersChanged(): void {
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
      this.schedule("workspace.changed");
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    void this.publishWorkspaceClosed().catch((error) => {
      this.output.error(error instanceof Error ? error.message : String(error));
    });
  }

  private async publishWorkspaceClosed(): Promise<void> {
    const workspaceId = this.workspaceId;
    const revision = this.revision;

    // Capture the closing workspace before clearing local state so a newly opened
    // workspace can start at revision 1 while this event waits in the publish queue.
    this.workspaceId = undefined;
    this.revision = 0;

    if (!this.paired || !workspaceId || revision < 1) return;

    const publish = this.publishQueue.then(async () => {
      if (!this.paired) return;
      const eventMessage = await this.envelope({
        type: "event.publish",
        event: {
          kind: "workspace.closed",
          workspaceId,
          revision,
        },
      });
      await this.send(eventMessage);
    });
    this.publishQueue = publish.catch(() => undefined);
    await publish;
  }

  private async buildSnapshot(): Promise<IdeWorkspaceSnapshot | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) return undefined;
    const roots = folders.map((folder) => ({ uri: folder.uri.toString(), name: folder.name }));
    const nextWorkspaceId = `vscode:${sha256(roots.map((root) => root.uri).sort().join("\n"))}`;
    if (this.workspaceId !== nextWorkspaceId) {
      this.workspaceId = nextWorkspaceId;
      this.revision = 0;
    }
    const parentRevision = this.revision || undefined;
    this.revision += 1;
    const now = Date.now();
    const policy = sharingPolicy();
    const editor = vscode.window.activeTextEditor;
    const maxBufferChars = Math.max(1_000, Math.min(500_000, config().get("maxBufferChars", 100_000)));

    const activeEditor = policy.shareActiveFile && editor
      ? {
          uri: editor.document.uri.toString(),
          languageId: editor.document.languageId,
          documentVersion: editor.document.version,
          isDirty: editor.document.isDirty,
          selection: policy.shareSelection
            ? this.buildSelection(editor, maxBufferChars)
            : undefined,
          // Experimental advisor mode shares the complete active document
          // buffer even when it is already saved. isDirty still tells Ari
          // whether the payload differs from disk.
          unsavedBuffer: policy.shareUnsavedBuffers
            ? this.truncatedPayload(editor.document.getText(), maxBufferChars)
            : undefined,
        }
      : undefined;

    const snapshot: IdeWorkspaceSnapshot = {
      workspaceId: nextWorkspaceId,
      projectId: `project:${sha256(roots.map((root) => root.uri).sort().join("\n"))}`,
      roots,
      revision: this.revision,
      parentRevision,
      capturedAt: now,
      expiresAt: now + SNAPSHOT_TTL_MS,
      snapshotSha256: "0".repeat(64),
      provenance: {
        source: "ide_bridge",
        client: "vscode",
        clientInstanceId: this.clientInstanceId,
        collectedAt: now,
        trust: "untrusted_external_data",
      },
      sharing: policy,
      activeEditor,
      diagnostics: policy.shareDiagnostics ? this.readDiagnostics() : undefined,
      git: policy.shareGitStatus ? this.readGit() : undefined,
      recentTests: policy.shareTestResults ? this.recentTests : undefined,
    };
    snapshot.snapshotSha256 = snapshotHash(snapshot);
    return snapshot;
  }

  private buildSelection(editor: vscode.TextEditor, maxChars: number) {
    const selection = editor.selection;
    const value = editor.document.getText(selection);
    return {
      range: toRange(selection),
      text: value ? this.truncatedPayload(value, maxChars) : undefined,
    };
  }

  private truncatedPayload(value: string, maxChars: number): IdeTextPayload {
    const truncated = value.length > maxChars;
    return textPayload(truncated ? value.slice(0, maxChars) : value, truncated);
  }

  private readDiagnostics(): IdeDiagnostic[] {
    const diagnostics: IdeDiagnostic[] = [];
    for (const [uri, entries] of vscode.languages.getDiagnostics()) {
      for (const entry of entries) {
        diagnostics.push({
          uri: uri.toString(),
          range: toRange(entry.range),
          severity: diagnosticSeverity(entry.severity),
          message: entry.message.slice(0, 4_000),
          source: entry.source?.slice(0, 200),
          code: entry.code === undefined
            ? undefined
            : typeof entry.code === "object"
              ? String(entry.code.value).slice(0, 200)
              : String(entry.code).slice(0, 200),
        });
        if (diagnostics.length >= 500) return diagnostics;
      }
    }
    return diagnostics;
  }

  private readGit(): IdeGitSnapshot[] {
    return (this.gitApi?.repositories ?? []).map((repository) => {
      const changes = [
        ...repository.state.workingTreeChanges,
        ...repository.state.indexChanges,
        ...repository.state.mergeChanges,
      ].slice(0, 1_000);
      return {
        repositoryRootUri: repository.rootUri.toString(),
        branch: repository.state.HEAD?.name,
        head: repository.state.HEAD?.commit,
        dirty: changes.length > 0,
        changes: changes.map((change) => ({
          uri: change.uri.toString(),
          status: String(change.status),
        })),
      };
    });
  }

  private async sendHello(auth: IdeBridgeAuth): Promise<void> {
    const message: IdeClientMessage = {
      protocolVersion: PROTOCOL_VERSION,
      type: "hello",
      messageId: randomUUID(),
      sequence: await this.nextSequence(auth.sessionId),
      sentAt: Date.now(),
      auth,
      client: "vscode",
      clientInstanceId: this.clientInstanceId,
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
    await this.send(message);
  }

  private async envelope(
    payload: Omit<Extract<IdeClientMessage, { type: "event.publish" }>,
      "protocolVersion" | "messageId" | "sequence" | "sentAt" | "auth">,
  ): Promise<IdeClientMessage> {
    const sessionId = config().get<string>("sessionId", "");
    return {
      protocolVersion: PROTOCOL_VERSION,
      messageId: randomUUID(),
      sequence: await this.nextSequence(sessionId),
      sentAt: Date.now(),
      auth: { sessionId, token: "" },
      ...payload,
    };
  }

  private async send(message: IdeClientMessage): Promise<void> {
    if (!this.endpoint || !this.auth) return;
    const authenticated = { ...message, auth: this.auth };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ari-ide-protocol": String(PROTOCOL_VERSION),
        },
        body: JSON.stringify(authenticated),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Ari IDE Bridge returned HTTP ${response.status}`);
      }
      const raw = (await response.json()) as unknown;
      this.handleServerMessage(raw);
    } finally {
      clearTimeout(timeout);
    }
  }

  private handleServerMessage(raw: unknown): void {
    if (!raw || typeof raw !== "object" || !("type" in raw)) {
      this.output.warn("Ignored malformed Ari IDE Bridge response");
      return;
    }
    const message = raw as IdeServerMessage;
    if (message.protocolVersion !== PROTOCOL_VERSION) return;
    if (message.type === "welcome") {
      if (message.acceptedClientInstanceId !== this.clientInstanceId) return;
      this.paired = true;
      this.setStatus("connected");
      void this.publishInitialSnapshot();
      return;
    }
    if (message.type === "ack") {
      if (message.acceptedRevision !== undefined) {
        this.output.info(`IDE snapshot revision ${message.acceptedRevision} accepted`);
      }
      return;
    }
    if (message.type === "error") {
      this.output.warn(`${message.code}: ${message.message}`);
      if (message.code === "STALE_REVISION" && message.expectedRevision !== undefined) {
        this.revision = message.expectedRevision;
        this.publishGeneration += 1;
        this.publishQueue = Promise.resolve();
        this.output.info(
          `Recovering snapshot stream from revision ${message.expectedRevision}`,
        );
        // The error handler runs inside the request currently occupying the
        // publish queue. Start recovery on the next event-loop turn so it does
        // not depend on (or deadlock behind) that rejected queue chain.
        setTimeout(() => {
          void this.publishSnapshot("workspace.changed").catch((error) => {
            this.output.error(error instanceof Error ? error.message : String(error));
          });
        }, 0);
      }
      if (message.code === "SESSION_EXPIRED" || message.code === "UNAUTHORIZED") {
        this.disconnect();
      }
    }
  }

  private async publishInitialSnapshot(): Promise<void> {
    const publish = this.publishQueue.then(async () => {
      const snapshot = await this.buildSnapshot();
      if (!snapshot) return;
      const sessionId = config().get<string>("sessionId", "");
      const message: IdeClientMessage = {
        protocolVersion: PROTOCOL_VERSION,
        type: "snapshot.publish",
        messageId: randomUUID(),
        sequence: await this.nextSequence(sessionId),
        sentAt: Date.now(),
        auth: { sessionId, token: "" },
        snapshot,
      };
      await this.send(message);
    });
    this.publishQueue = publish.catch(() => undefined);
    await publish;
  }

  private async restoreSequence(sessionId: string): Promise<void> {
    const sessionIdSha256 = sha256(sessionId);
    if (this.sequenceSessionHash === sessionIdSha256) return;
    const persisted = this.context.globalState.get<PersistedSequenceState>(SEQUENCE_STATE_KEY);
    const validPersistedSequence =
      persisted?.clientInstanceId === this.clientInstanceId &&
      persisted.sessionIdSha256 === sessionIdSha256 &&
      Number.isSafeInteger(persisted.sequence) &&
      persisted.sequence >= 0;
    this.sequence = validPersistedSequence ? persisted.sequence : 0;
    this.sequenceSessionHash = sessionIdSha256;
    if (!validPersistedSequence) {
      await this.persistSequenceState();
    }
  }

  private async resetSequence(sessionId: string): Promise<void> {
    this.sequence = 0;
    this.sequenceSessionHash = sha256(sessionId);
    await this.persistSequenceState();
  }

  private async readConnectionFile(uri: vscode.Uri): Promise<IdeConnectionFile> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > 64 * 1024) {
      throw new Error("Connection file is too large");
    }
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as IdeConnectionFile;
    if (
      parsed.protocolVersion !== PROTOCOL_VERSION ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.token !== "string" ||
      parsed.token.length < 32 ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      throw new Error("Connection file is malformed or expired");
    }
    parsed.endpoint = validateLoopbackEndpoint(parsed.endpoint);
    return parsed;
  }

  private async nextSequence(sessionId: string): Promise<number> {
    await this.restoreSequence(sessionId);
    this.sequence += 1;
    await this.persistSequenceState();
    return this.sequence;
  }

  private async persistSequenceState(): Promise<void> {
    if (!this.sequenceSessionHash) {
      throw new Error("IDE bridge sequence is not scoped to a pairing session");
    }
    await this.context.globalState.update(SEQUENCE_STATE_KEY, {
      clientInstanceId: this.clientInstanceId,
      sessionIdSha256: this.sequenceSessionHash,
      sequence: this.sequence,
    } satisfies PersistedSequenceState);
  }

  private setStatus(state: "connecting" | "connected" | "disconnected"): void {
    if (state === "connected") {
      this.status.text = "$(verified-filled) Ari";
      this.status.tooltip = "Ari IDE Advisor is connected";
      return;
    }
    if (state === "connecting") {
      this.status.text = "$(sync~spin) Ari";
      this.status.tooltip = "Connecting to Ari IDE Advisor";
      return;
    }
    this.status.text = "$(debug-disconnect) Ari";
    this.status.tooltip = "Ari IDE Advisor is disconnected";
  }
}

let client: AriIdeBridgeClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = new AriIdeBridgeClient(context);
  context.subscriptions.push(client);
  if (config().get("autoConnect", true)) {
    const pairedFromDesktop = await client.autoPairFromDefaultFile();
    if (!pairedFromDesktop) await client.connect();
    const autoPairTimer = setInterval(() => {
      void client?.autoPairFromDefaultFile();
    }, 5_000);
    context.subscriptions.push({ dispose: () => clearInterval(autoPairTimer) });
  }
}

export function deactivate(): void {
  client?.dispose();
  client = undefined;
}
