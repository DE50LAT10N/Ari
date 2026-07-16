# Privacy — Ari Desktop Character

## Local storage with a proactive-first profile

By default Ari stores chat history, memory, mood, relationship state, RAG
metadata, and settings on your machine (browser `localStorage` / IndexedDB and
Tauri app data). The proactive-first profile does, however, enable live web
requests and local activity/clipboard observation by default so Ari can initiate
useful conversations. In GigaChat mode, selected context may leave the device.

## GigaChat API mode

When **GigaChat API** is selected, Ari sends only the data required for each
enabled feature to Sber's GigaChat API:

- conversation messages and system prompt cont
The Authorization key is stored with Windows DPAPI under Ari's app-data directory.
It is not written to `localStorage`, chat history, or logs.

Uploaded vision files are deleted from GigaChat storage after the request completes.
ext;
- memory and RAG fragments selected for the current request;
- structured background tasks (memory extraction, initiative gating) when enabled;
- images or OCR pages only after the same explicit user actions as in local mode.

## Activity and window context

If **window context** is enabled, Ari reads the active window title and process
name locally to tailor reactions. This metadata is not sent to Ollama; in GigaChat
mode it may be included in prompts when relevant.

With **full clipboard capture** enabled by the proactive-first profile, Ari polls the clipboard when
it changes, classifies content (code, stack trace, URL, text), **redacts secrets**
(API keys, tokens, passwords, long blobs) before storage, and keeps redacted
snippets locally for ~8 hours. Nothing is uploaded unless you use GigaChat and
the advisor includes recent activity in a prompt.

The **programmer advisor** aggregates window/file focus, clipboard signals, chat
queries, and browser search topics (from window titles) to suggest breaks,
debugging help, refocus, and dynamic check-in topics. All processing is local;
advice references “activity”, not screen vision.

## IDE Advisor

The IDE Bridge is off by default and starts only after **IDE Advisor** consent in
onboarding or Settings. It binds an ephemeral port on `127.0.0.1` and requires a
short-lived, OS-random pairing credential. The connection file is stored in the
current user's app-data directory and removed after pairing or when the bridge is
disabled.

VS Code sharing is granular and off by default: active-file metadata, selection,
unsaved buffer, diagnostics, Git status, and test output each have their own
setting. Ari validates revision, expiry, content hashes, and provenance, then
treats every IDE value as untrusted evidence. Sharing context never grants
permission to edit files or run commands. With Ollama, mentor evidence stays on
the machine; with GigaChat, evidence selected for a mentor answer is included in
that cloud request.

## Live web tools

Live search and page fetching are enabled by the proactive-first profile. Ari may
send a search query or request a public URL when it needs current information;
the remote service can observe the request and your network address. The native
fetcher rejects local/private destinations and credentials, follows only bounded
validated redirects, strips sensitive headers, and caps request and response
sizes. Web results are treated as untrusted evidence rather than instructions.

The proactive-first migration turns activity tracking, clipboard capture, the
programmer advisor, event reactions, and live web tools back on once. You can
still disable individual sources later in Settings.

## Backups

Manual backups export local data to a ZIP on your device. Backups exclude the
GigaChat Authorization key.

## Updates

If auto-update is configured, Ari may download signed installers from the release
endpoint defined in `tauri.conf.json`. A local backup is created before installing
an update.

## Contact

This is an open-source desktop companion. Review the source in this repository for
exact request payloads and retention behavior.
