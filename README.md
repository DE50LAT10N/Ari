# Ari — Desktop Character Companion

**Version: 1.2.0**

Ari is a local desktop companion built with **Tauri 2**, **React**, and **TypeScript**. She lives in a transparent always-on-top window, opens chat on click, and talks through either **local Ollama** or the **GigaChat API** (user choice).

This README is the entry point. Full reference lives in [`docs/`](docs/).

---

## Quick start

### Local Ollama

1. Install [Ollama](https://ollama.com) and pull a chat model (see [Recommended models](#recommended-models)).
2. Run:

```powershell
npm install
npm run tauri dev
```

Default API: `http://127.0.0.1:11434/api/chat`

### GigaChat API

Select **GigaChat API** in settings, save your Authorization key, and choose models. Ollama is not required.

- Chat / memory / initiative: `GigaChat`
- Vision: `GigaChat`
- RAG embeddings: `EmbeddingsGigaR`

The Authorization key is encrypted with **Windows DPAPI** — never stored in `localStorage`, chat history, or logs.

Docs: https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api

### Build

```powershell
npm run build
npm run tauri build
```

Windows NSIS installer:

```powershell
npm run tauri build -- --bundles nsis
```

Output: `src-tauri/target/release/bundle/nsis`

---

## Install and run on a new Windows PC

### 1. Install prerequisites

Install:

- Git
- Node.js 20+ LTS
- Rust stable via `rustup`
- Microsoft WebView2 Runtime, if it is not already installed
- Optional: Ollama, if you want local models

Restart PowerShell after installing Node/Rust so `npm`, `node`, `cargo`, and `rustc` are on `PATH`.

### 2. Clone and install dependencies

```powershell
git clone <REPOSITORY_URL> ari-desktop-character
cd ari-desktop-character
npm ci
```

### 3. Choose a model provider

For local Ollama:

```powershell
ollama run hf.co/Qwen/Qwen3-14B-GGUF:Q5_K_M
```

If your Windows username or model path contains Cyrillic characters, set an ASCII-only model folder:

```powershell
setx OLLAMA_MODELS "<OLLAMA_MODELS_DIR>"
setx OLLAMA_ORIGINS "http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420"
```

Restart Ollama after changing these variables.

For GigaChat, open Ari Settings after first launch and save your Authorization key there. Do not put keys in `.env`, source files, README, screenshots, or git commits.

### 4. Run from source

```powershell
npm run tauri dev
```

### 5. Build an installer

```powershell
npm run build
npm run tauri build -- --bundles nsis
```

Installer output:

```text
src-tauri/target/release/bundle/nsis
```

### 6. Install from a release artifact

If you already have a release installer, run:

```text
Ari Desktop Character_<VERSION>_x64-setup.exe
```

On first launch, complete onboarding and choose Ollama or GigaChat in Settings.

---

## Recommended models (~16 GB VRAM)

| Role | Suggestion |
|------|------------|
| Main chat | `qwen2.5:14b-instruct-q5_K_M` or `q6_K` |
| Vision | `qwen2.5vl:7b` |
| Embeddings (local RAG) | `embeddinggemma` |

Do not keep a 32B text model and vision loaded simultaneously.

Official Qwen3 bundle:

```powershell
ollama run hf.co/Qwen/Qwen3-14B-GGUF:Q5_K_M
```

### Cyrillic Windows path issue

Set `OLLAMA_MODELS` to an ASCII-only folder in Ari settings or replace `<OLLAMA_MODELS_DIR>` with your own path:

```powershell
setx OLLAMA_MODELS "<OLLAMA_MODELS_DIR>"
setx OLLAMA_ORIGINS "http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420"
```

Restart Ollama after changing origins (fixes HTTP 403 from Tauri).

---

## Documentation map

| Document | Contents |
|----------|----------|
| [docs/FEATURES.md](docs/FEATURES.md) | Complete user-facing feature reference |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Guided first-session tour for new users |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, module map, chat/initiative flows, storage |
| [docs/ML.md](docs/ML.md) | Retrieval, adaptive initiative, intent, mood, memory, prompts |
| [docs/METRICS.md](docs/METRICS.md) | Telemetry, scoring formulas, hardcoded constants |
| [docs/COMMANDS.md](docs/COMMANDS.md) | All chat commands (tasks, focus, git, reviews, help) |
| [docs/MODULES.md](docs/MODULES.md) | Function-level reference for `src/**` |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every settings field and model routing |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Scripts, tests, release, assets |
| [docs/MANUAL_QA_CHECKLIST.md](docs/MANUAL_QA_CHECKLIST.md) | Manual test scenarios for desktop, UI, vision, providers |
| [PRIVACY.md](PRIVACY.md) | Cloud vs local data |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

**In chat:** ask Ari `что ты умеешь`, `help`, or `расскажи о возможностях` for a settings-aware capability overview.

---

## What Ari does **not** do

- No continuous screen recording or background screenshots
- No keystroke or mouse position logging
- No shell/PowerShell/automatic clicks from safe actions
- No cloud calendar for reminders
- No Live2D (PNG sprites only)
- No false claims about seeing the screen or completing unconfirmed actions

---

## Release checklist

1. Bump version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` when preparing an RC.
2. Run `npm run smoke` (version alignment, build, unit tests).
3. Run `npm run qa:acceptance` (automated proactive/signal gates).
4. Run `npm run test:retrieval` (offline lexical recall suite).
5. Manual UX: resize window 400×560 → 800×900 — task board must not cover Ari or ambient bubbles.
6. Empty «Дела» hides the board; adding a task shows it with enter animation.
7. Settings → «Умный retrieval»: MMR on, adaptive initiative off by default.
8. Full restart of `npm run tauri dev` after changing Tauri capabilities.
9. Build installer: `npm run tauri build -- --bundles nsis`.
10. Sign the release and publish artifacts.
11. Before re-enabling in-app auto-updates: generate real Tauri updater signing keys, set `plugins.updater.active: true` in `tauri.conf.json`, and publish a signed `latest.json`.

---

## Architecture (overview)

```
src/
  app/           App, ChatPanel, AriTaskBoard, Settings, Memory
  tasks/         taskStore, taskMigration
  memory/        userMemory, episodicMemory, RAG, retrieval
  character/     mood, relationship, initiative, pomodoro, voice
  llm/           Ollama + GigaChat clients, vision, embeddings
  platform/      Tauri bridge, backup, autostart, credentials
  chat/          history, commands, context trim
  rag/           document indexing and search
  tools/         safe actions, live web tools
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams and storage keys.
