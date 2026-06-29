# Development

## Scripts (`package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite` | Frontend dev server |
| `tauri dev` | `tauri dev` | Full desktop app (use this for Ari) |
| `build` | `tsc && vite build` | Typecheck + production bundle |
| `preview` | `vite preview` | Preview production build |
| `test:unit` | vitest + unit scripts + sprite validation | Unit tests (134+ vitest) |
| `test:character` | Ollama character regression | Optional LLM tests |
| `test:retrieval` | retrieval eval script | Lexical recall suite |
| `smoke` | smoke-check.mjs | Version + build + unit smoke |
| `qa:acceptance` | qa-acceptance.mjs | Automated proactive/signal QA gates |
| `simulate:advisor` | advisorSimulation.test.ts | Advisor angle + package report |
| `validate:sprites` | sprite asset validation | 18 emotions + 2 states |
| `generate-assets` | placeholder sprite generator | Dev assets |
| `fetch-gigachat-certs` | GigaChat CA fetch | TLS setup |
| `tauri build` | Production Tauri build | Windows installer |

## Test suites (`tests/`)

| File | Covers |
|------|--------|
| `taskStore.test.ts` | Task CRUD, due, snooze |
| `taskMigration.test.ts` | Legacy → unified store |
| `taskChatParse.test.ts` | Natural language task commands |
| `initiativeScoring.test.ts` | Local initiative scoring |
| `initiativeContext.test.ts` | Proactive package, anchor, liveliness |
| `advisorSimulation.test.ts` | Advisor angles, cadence, package prompts |
| `advisorEngine.test.ts` | Advisor angles and conversation topics |
| `proactiveLoop.test.ts` | Proactive loop scoring and gates |
| `interruptibility.test.ts` | Distraction nudge during focus+pomodoro |
| `scenarioEngine.test.ts` | Scenario cooldown post-send |
| `initiativeFlow.test.ts` | Interruptibility + tasks |
| `characterDepth.test.ts` | Scenarios, idle, mood, caps |
| `characterVoice.test.ts` | Feminine grammar + assistant-tone validation |
| `proactiveBridge.test.ts` | App → ChatPanel proactive queue |
| `capabilities.test.ts` | Capabilities overview command |
| `retrievalRecall.test.ts` | Lexical recall |
| `rerank.test.ts` | MMR |
| `ivfIndex.test.ts` | IVF search |
| `memoryScoring.test.ts` | Tokenize, mixed recall |
| `contextBudget.test.ts` | History trim |
| `liveliness.test.ts` | Presence/attention |
| `promptSafety.test.ts` | Injection wrap |
| `userIntent.test.ts` | Intent rules |
| `liveTools.test.ts` | Web tools |
| `visionConfig.test.ts` | Vision routing |
| `emotionAssets.test.ts` | Sprite paths |

Run all unit tests:

```powershell
npm run test:unit
npm run test:retrieval
npm run smoke
npm run qa:acceptance
```

## Project layout

```
desktop-character/
  src/           Application source
  src-tauri/     Rust Tauri backend
  tests/         Vitest suites
  scripts/       Build/test helpers
  public/        Static assets (sprites)
  docs/          Full documentation
```

## Release and signing

1. Align version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
2. `npm run smoke` and `npm run test:retrieval`.
3. Manual UX checklist (see README release checklist).
4. `npm run tauri build -- --bundles nsis`.
5. Sign installer; publish artifacts.
6. Auto-updater: requires Tauri signing keys + `latest.json` (disabled by default).

## Sprite validation

`validate:sprites` ensures emotion/state PNG sets under `public/characters/ari/` match expected names. Run after asset changes.

## Logging

Application logs: Tauri app-data directory, rotating (5 × 1 MB). Open from Settings → About.

## Contributing notes

- Settings changes: update `defaultSettings`, `docs/CONFIGURATION.md`, and `capabilitiesOverview.ts` if user-visible.
- New chat commands: `chatCommands.ts` / `taskChatParse.ts`, `commandCharacterWrap.ts`, `docs/COMMANDS.md`, tests.
- Initiative/memory changes: update `docs/ML.md` and `docs/METRICS.md` constants tables.
