# Features (user reference)

## Window and tray

- Drag via handle; resize from corner; position/size restored on launch.
- Minimize to tray; Alt+F4 hides without quitting.
- Full shutdown via power button (stops LLM, saves state).

## Chat

- Streaming replies with stop button.
- Emotion per assistant message (`<emotion>tag</emotion>`).
- History up to 200 messages; context auto-trimmed for LLM.
- Regenerate last reply; clear history (with confirmation).
- Teach Ari mode: save behaviour rules from chat.
- Proactive ambient bubble when chat is closed.
- Response length: short / medium / long (auto by query).

## Character visuals

### Emotions (sprites)

`neutral`, `happy`, `amused`, `annoyed`, `curious`, `empathetic`, `blush`, `bored`, `calm`, `surprised`, `pensive`, `worried`, `proud`, `shy`, `determined`, `sad`, `sleepy`, `excited`, `annoyed`, etc.

### Visual states

`idle`, `listening`, `thinking`, `speaking`, `error`

### Reaction overlays (no LLM)

`?`, `!`, heart, angry mark, sparks, `…` — rate-limited.

### Presence scenes

`morning`, `focus`, `break`, `evening`, `night`, `away` — from time + idle + attention.

### Micro-reactions

Rare silent face changes when chat closed; blocked during generation or long idle.

### Extras

Blink, mouse parallax, hover curiosity, optional UI sounds (muted at night).

## Behaviour engine

- **Mood** (hidden): warmth, energy, irritation; decays over hours.
- **Relationship**: familiarity, trust, playfulness; bond milestones.
- **Attention**: listening / observing / waiting / daydreaming / sleepy.
- **Lifecycle**: awake / drowsy / sleeping from idle + quiet mode.
- **Self-memory**: preferred tone, stopped behaviours, phrase anti-repeat.
- **Initiative kinds** (`InitiativeKind`): check-in, break suggestion, unfinished thread, return reaction, context comment, memory callback, process advice, distraction nudge, quiet presence, screen glance.
- **Scenarios** (separate from kinds): `first_message_today` (daily rituals → spoken as `check_in`), `reminder_due` (due tasks → `unfinished_thread`).
- **Pacing**: local score, cooldowns, ignored-window feedback, and quiet modes without a hard daily shutdown.
- **Honest context**: no false vision/memory/RAG claims in prompts.

## Task manager

Unified store (`taskStore`): kinds `task`, `thread`, `reminder`, `decision`; status `proposed`, `open`, `done`, `dismissed`.

**Inline task board** (when chat closed): focus session, pomodoro, now/next, proposed items, add task.

Spoken reminders for due tasks; initiative for high-priority open work.

## Focus and pomodoro

- Focus session: goal, step, blockers, subtasks in prompts.
- Pomodoro: focus/break/pause; body-doubling toggle.
- Quiet mode: 30 min / 1 h / until evening / per-process / manual.

## Project binder

- Named projects with root path, goals, notes.
- Pin README; list recent files.
- Read-only git: status, log, diff (no write commands).

## Memory

### Long-term facts (IndexedDB)

Extract after replies; importance + confidence; inbox for low-confidence; consolidation at 100 facts; conflict resolution.

### Episodes

Narrative events; semantic + lexical retrieval.

### Working memory

Short-term window switches, focus updates (7h TTL).

### Activity timeline

Pomodoro, focus, memory, reminders, vision, chat commands, reviews.

### RAG (opt-in)

Index `.txt`, `.md`, `.json`, `.pdf`, images; vectors in IndexedDB; up to `ragTopK` chunks per reply.

### Active window (opt-in)

Foreground process name + window title; optional allowlist. No keystrokes.

### Clipboard and programmer advisor

- **Full clipboard capture** (on in the proactive-first profile): classification, secret redaction, and local storage for ~8 h.
- **Advisor**: aggregates file focus, queries, errors → break/debug/refocus advice and dynamic check-in topics.
- Legacy **clipboard error notes** toggle still adds stack traces to working memory.

### IDE Advisor (opt-in)

The loopback-only IDE Bridge starts only after separate consent. The VS Code client can share the active file, selection, unsaved buffer, diagnostics, Git state, and test state; every optional source is disabled until enabled in VS Code. Ari validates revision order, freshness, provenance, and content hashes before using the bounded snapshot as untrusted mentor evidence. See [IDE_BRIDGE.md](IDE_BRIDGE.md).

## Vision

Eye button: hide Ari → capture window → one-shot vision model → discard PNG.

Modes: overview, error hunt, OCR, explain UI, region select, two-capture compare.

Observation text persists 0–120 minutes without keeping the image.

Auto vision glance when enabled and gated.

## Character and voice

- Ari is an **AI VN-style character with a feminine presentation**: irony, warmth, short lines — not a corporate assistant or a human identity claim.
- **Feminine grammar** in prompts and validation (`я готова`, not `я готов`).
- **Mood** shapes lexicon, proactive bundle, idle lines, and avatar emotion.
- **Proactive bridge**: App events use `proactiveBridge` → unified package in ChatPanel.

## Initiative and rituals

Requires proactive enabled. Respects interval, quiet hours, anti-annoyance.

All LLM proactive replies (check-in, advisor, memory callback, tasks, distraction nudge, PC/scenario events) are built through a unified **proactive initiative package**: activity signals, practical advice rule, anchor, banned-topic guard, and Ari liveliness hints — so replies stay useful and in character, not generic assistant tone.

**Daily rituals**: morning, midday (weekdays), evening — first message of slot.

**Event reactions**: window switch, long session, deep work, return after absence.

**Scenario packs**: default, quiet-work, night-owl (toggle in settings).

## Safe actions

Opt-in confirmed actions: open URL, open file/folder, clipboard copy, create note. Proposal card → Allow/Reject.

## Blip voice

Animalese-style synthesis; emotion pitch; mute during focus/night/quiet mode.

## Notifications

Local toasts for proposed tasks, memory inbox, etc.

## Backup

Export/import ZIP: settings, chat, memory, tasks, relationship, mood, RAG metadata, binders.

## Onboarding

First-run wizard: provider, name, tone, opt-in toggles, Companion preset.

## Chat help

Ask `что ты умеешь`, `help`, or `расскажи о возможностях` for a settings-aware capability list. See [COMMANDS.md](COMMANDS.md).
