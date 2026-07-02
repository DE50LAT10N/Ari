# Ari QA acceptance report

Generated: 2026-07-02T05:15:23.956Z

## Automated results

| Check | Status | Note |
|-------|--------|------|
| auto-gates | pass | npm run smoke exit 0 |
| env-setup | pass | advisor default on |
| env-setup | pass | clipboard full capture default on |
| env-setup | pass | activity tracking default on |
| env-setup | pass | proactive default on |
| signals-qa | pass | ChatPanel: clipboard capture wired |
| signals-qa | pass | ChatPanel: file focus wired |
| signals-qa | pass | ChatPanel: query topic wired |
| signals-qa | pass | ChatPanel: redaction before storage |
| signals-qa | pass | ChatPanel: clipboard classification |
| signals-qa | pass | ChatPanel: browser topic parse |
| signals-qa | pass | diagnostics shows activity signals |
| signals-qa | pass | qaSignalsIntegration + advisor tests green |
| proactive-qa | pass | initiative loop uses unified package, not buildWorkProcessAdvice |
| proactive-qa | pass | long_focus routes through proactive package with spokenHint |
| proactive-qa | pass | unified proactive launch helper wired |
| proactive-qa | pass | proactiveBridge replaces legacy interactionEvent |
| proactive-qa | pass | dynamic check-in topics wired |
| proactive-qa | pass | local fallback after failed LLM attempt |
| proactive-qa | pass | checkInitiative does not require LLM for entry |
| proactive-qa | pass | generic check-in passes conversation topics |
| proactive-qa | pass | rich proactive context module wired in initiativeContext |
| proactive-qa | pass | proactive signal summary passed to generateReply |
| proactive-qa | pass | LLM bundle synthesis wired in proactive package prep |
| proactive-qa | pass | Proactive Lab + LLM engine + command tail parser present |
| proactive-qa | pass | assistant moves playbook + topic link graph wired |
| proactive-qa | pass | RAG prefetch wired into proactive synthesis prep |
| proactive-qa | pass | immersed session uses companion silence for generic check-in |
| proactive-qa | pass | failed advice backs off instead of hard return |
| proactive-qa | pass | planned check-in uses LLM proactive package |
| proactive-qa | pass | planned check-in uses rich proactive package |
| proactive-qa | pass | planned anchor does not force window title fallback |
| proactive-qa | pass | proactive grace period on enable |
| proactive-qa | pass | GigaChat online respects App status poll |
| proactive-qa-manual | manual | Run tauri dev: 50min session / window_switch / ambient bubble — see docs/QA_ACCEPTANCE_REPORT.md |
| capabilities-qa | pass | capabilities.test.ts green |
| capabilities-qa | pass | taskChatParse.test.ts green |
| capabilities-qa | pass | capabilitiesOverview mentions advisor + clipboard |
| privacy-qa | pass | secretRedaction.test.ts green |
| privacy-qa | pass | activitySignals redacts before push |
| privacy-qa-manual | manual | In app: toggle advisor OFF, verify no new query_topic; inspect localStorage desktop-character.activity-signals.v1 |

## Release gate (plan §7)

**Automated gate: PASS** (unit tests + smoke). Manual tauri scenarios still required.

### Ship-ready (automated)

- build + test:unit + smoke: green
- Unified proactive package + launchProactiveInitiative in ChatPanel (no buildWorkProcessAdvice in loop)
- Signal layer integration: clipboard/file_focus/query_topic + redaction
- Capabilities + task commands: unit tests green

### Fix list applied during QA

- `idleLines.ts`: anti-repeat now tracks template keys (fixed flaky characterDepth test)

### QA profile for manual run

Settings → «Компаньон» + `initiativeLevel: active`, `proactiveIntervalMinutes: 1` (revert after).
Ollama or GigaChat online; quiet mode off.

### Remaining manual (before full ship)

| Scenario | Status |
|----------|--------|
| Clipboard signals in diagnostics UI | pending manual |
| File focus after 5+ min IDE | pending manual |
| Proactive advisor reply (rest/topic) | pending manual |
| long_focus break with session minutes | pending manual (50 min) |
| Ambient bubble with chat closed | pending manual |
| Toggle advisor OFF stops query capture | pending manual |

## Manual checklist (tauri dev)

1. Settings → Companion preset → Diagnostics open
2. Clipboard: code / url / stacktrace / password=secret → signals + redaction
3. IDE 5+ min → switch window → file_focus line
4. Chat question + Google tab title → query_topic + check-in topics
5. initiativeLevel active, interval 1 min → advisor initiative or angle in diagnostics
6. `что ты умеешь`, `добавь задачу …`, `старт фокуса: …`
