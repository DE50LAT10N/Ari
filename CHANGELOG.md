# Changelog

## 1.2.0 — 2026-06-28

### Character voice
- Explicit feminine grammar for Ari in character card, prompts, validation, and retry
- VN-style proactive liveliness (`VN_CHARACTER_RULE`); character before practical advice on social kinds
- Stronger mood influence in prompts, proactive bundle, avatar emotion, and idle lines
- Anti-bland validation for assistant-tone openings

### Tech debt
- Legacy `interactionEvent` removed; `proactiveBridge` routes App/PC/scenario speech through unified package

## 1.1.1 — 2026-06-28

### Mechanics polish
- Distraction nudge works during focus + pomodoro (`allowsInitiativeForKind`)
- Scenario cooldown applied only after successful send (rituals/reminders can retry)
- GigaChat-aware LLM gate for reminders and daily rituals
- Advisor `process_advice` when signals exist but no specific angle
- Unified `startProductivityFocus` (focus session + pomodoro) from task board and chat commands

### Code health
- `emitLocalCompanionLine` deduplicates local idle-line emission
- Removed dead wrappers: `buildWorkProcessAdvice`, `buildAdvisorInitiative`, `buildPlannedCheckContext`
- `quiet_presence` via proactive package; liveliness hint added
- Single `unfinished_thread` scheduler in proactive loop
- Proactive LLM → micro-reaction bridge when chat closed; optional blip on local lines
- Prompt liveliness dedup when already in event description

## 1.1.0 — 2026-06-28

### Proactive initiative (unified architecture)
- All LLM proactive paths use `buildProactiveInitiativePackage`: rich signals, practical advice rule, anchor, and anti-repeat
- `launchProactiveInitiative` in ChatPanel for advisor, check-in, memory callback, tasks, distraction nudge, PC reactions, and scenarios
- `proactiveLiveliness` + `proactiveKindToResponseMode` keep replies in character (not generic assistant tone)
- Planned check-in: skip broad topic overlap when fresh topics exist; browser-only query topics in check-in list

### Tests and QA
- 125 unit tests; `qa:acceptance` and advisor simulation updated for package pipeline
- CI runs smoke and QA acceptance gates

## 1.0.1 — 2026-06-27

### Liveliness
- Cozy sprite-set theme active during morning and evening scenes
- Independent idle micro-action loop (22–48 s) while the user is nearby
- Throttled typing perk: gaze nudge toward chat and brief curious reaction
- Variable proximity reactions by mood, scene, and time of day
- Ambient speech bubble for silent micro-reactions with `thought` when chat is closed

### Release polish
- `autoUpdateEnabled` setting (off by default); updater network check gated behind toggle
- Vite `manualChunks` split (`react`, `pdfjs`, `vendor`) to reduce bundle warnings
- Removed unused Rust import; sprite validation step in CI
- CHANGELOG updated

## 1.0.0 — 2026-06-27

### Liveliness (code/CSS)
- Global cursor gaze with spring physics on the avatar stage
- Squash-and-stretch reactions on click, headpat, and window drag
- CSS lip-sync driven by blip syllable events
- Sprite-set visual themes via CSS filters (`night`, `focus`, `cozy`)
- Random idle micro-actions in the ambient loop
- Cursor proximity perk-up reactions with cooldown
- Desktop speech bubble with typewriter text and blip voice when chat is closed

### Release
- Unified app version source (`package.json` → build)
- `CHANGELOG.md`, `LICENSE` (MIT), `PRIVACY.md`
- Bundle identifier: `app.ari.desktop`
- Placeholder icons and character sprites in repo
- React Error Boundary around the app root
- GitHub Actions CI: `npm run build` + `npm run test:unit`
- Vitest tests importing real `src/` modules
- Symmetric backup/import for journal, focus sessions, summaries, backlog, inbox, project binders, pomodoro
- GigaChat Authorization key step in onboarding
- Tauri auto-updater hook with `backupBeforeUpdate()` before install
- Lazy-loaded PDF.js and heavy settings sub-panels
- README aligned with implemented diagnostics scope

## 0.2.0

Earlier polish: memory scoring, scenarios, ambient bubble preview, onboarding companion preset.
