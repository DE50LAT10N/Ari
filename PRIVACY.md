# Privacy — Ari Desktop Character

## Local-first

By default Ari stores chat history, memory, mood, relationship state, RAG
metadata, and settings on your machine (browser `localStorage` / IndexedDB and
Tauri app data). Nothing is uploaded unless you enable a cloud feature.

## GigaChat API mode

When **GigaChat API** is selected, Ari sends only the data required for each
enabled feature to Sber's GigaChat API:

- conversation messages and system prompt context;
- memory and RAG fragments selected for the current request;
- structured background tasks (memory extraction, initiative gating) when enabled;
- images or OCR pages only after the same explicit user actions as in local mode.

The Authorization key is stored with Windows DPAPI under Ari's app-data directory.
It is not written to `localStorage`, chat history, or logs.

Uploaded vision files are deleted from GigaChat storage after the request completes.

## Activity and window context

If **window context** is enabled, Ari reads the active window title and process
name locally to tailor reactions. This metadata is not sent to Ollama; in GigaChat
mode it may be included in prompts when relevant.

If **full clipboard capture** is enabled (default), Ari polls the clipboard when
it changes, classifies content (code, stack trace, URL, text), **redacts secrets**
(API keys, tokens, passwords, long blobs) before storage, and keeps redacted
snippets locally for ~8 hours. Nothing is uploaded unless you use GigaChat and
the advisor includes recent activity in a prompt.

The **programmer advisor** aggregates window/file focus, clipboard signals, chat
queries, and browser search topics (from window titles) to suggest breaks,
debugging help, refocus, and dynamic check-in topics. All processing is local;
advice references “activity”, not screen vision.

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
