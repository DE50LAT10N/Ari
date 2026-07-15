# Ari IDE Advisor for VS Code

This extension publishes a revisioned IDE snapshot to the local Ari desktop app. It never edits files or runs commands. Ari receives editor context as untrusted evidence for its engineering-mentor modes.

> Experimental build: active file, selection, unsaved buffers, diagnostics, Git
> and test-result evidence are forced on. The `share*` settings remain visible for
> protocol compatibility but do not disable those channels in version 0.1.2.

## Build

```powershell
npm.cmd install --prefix ide-extensions/vscode
npm.cmd run check --prefix ide-extensions/vscode
npm.cmd run compile --prefix ide-extensions/vscode
```

For local development, open this directory as a VS Code extension project and press `F5` using **Run Ari IDE Advisor**. The included launch profile compiles the extension and opens an Extension Development Host. The compiled entry point is `dist/ide-extensions/vscode/src/extension.js` because the extension consumes the repository's authoritative protocol types.

## Pairing

1. Start Ari. The desktop app creates a short-lived JSON connection file.
2. With `autoConnect` enabled (the default), the extension discovers that file under `%APPDATA%\\app.ari.desktop`, stores the token in VS Code SecretStorage, and connects automatically.
3. Review what is shared under **Settings → Ari IDE Advisor**. The proactive profile enables IDE context sources by default; each source can still be disabled independently.

The **Ari: Pair IDE Advisor from Connection File** command remains available for non-standard profiles or manual recovery.

The token is copied to VS Code `SecretStorage`. The extension only accepts an explicit `http://127.0.0.1:<port>/ide/v1/messages` or IPv6 loopback endpoint.

The last outbound sequence is persisted in `globalState`, scoped to the stable client instance and a SHA-256 hash of the pairing session ID. Reloading VS Code therefore cannot replay sequence `1` into a still-live native session. A new pairing session resets this counter before its first `hello`.

For development, **Ari: Pair IDE Advisor Manually** accepts the same endpoint, session ID and token as separate prompts.

## Test adapter hook

Another extension can publish a completed test result after the user enables test-result sharing:

```ts
await vscode.commands.executeCommand("ari.ideBridge.publishTestResult", {
  id: "vitest:math",
  label: "math suite",
  status: "failed",
  durationMs: 820,
  output: "Expected 42, received 41",
});
```

Supported statuses are `passed`, `failed`, `skipped`, and `cancelled`. Output is capped and hashed before transport.
