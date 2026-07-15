# Configuration

All settings persist in `localStorage` key `desktop-character.settings.v1`. Defaults and types: `src/settings/appSettings.ts`.

## Provider and models

| Field | Default | Effect |
|-------|---------|--------|
| `llmProvider` | `ollama` | `ollama` or `gigachat` |
| `ollamaBaseUrl` | `http://127.0.0.1:11434` | Ollama API base |
| `ollamaModelsDir` | `""` | Optional `OLLAMA_MODELS` override hint |
| `model` | Qwen3-14B Q5_K_M | Main chat model (Ollama) |
| `fastJsonModel` | — | JSON/gate model (optional) |
| `memoryModel` | — | Extraction/summary model (optional) |
| `gigaChatModel` | `GigaChat-2-Pro` | Main chat (GigaChat) |
| `gigaChatVisionModel` | `GigaChat-2-Pro` | Vision model |
| `gigaChatEmbeddingModel` | `EmbeddingsGigaR` | Embeddings |
| `gigaChatScope` | `GIGACHAT_API_PERS` | API scope |
| `temperature` | 0.7 | LLM temperature |
| `maxTokens` | 1024 | Max reply tokens |
| `contextTokens` | 8192 | Context window budget |

## Embeddings and RAG

| Field | Default | Effect |
|-------|---------|--------|
| `ragEnabled` | false | Enable document RAG |
| `embeddingSource` | `ollama` | `gigachat`, `ollama`, or `none`; local by default |
| `embeddingModel` | `embeddinggemma` | Ollama embedding model name |
| `ragTopK` | 4 | Chunks injected per reply |
| `ragScoreThreshold` | 0.2 | Min cosine for RAG match |
| `memoryRelevanceFloor` | 0.12 | Min recall for facts/episodes |
| `recallLexicalWeight` | 0.4 | Lexical weight in mixed recall |
| `recallSemanticWeight` | 0.6 | Semantic weight |
| `embeddingQueryCacheTtlSec` | 300 | Query embedding cache TTL |
| `rerankEnabled` | true | MMR rerank |
| `llmRerankEnabled` | false | LLM listwise rerank (RAG) |

## Activity and context

| Field | Default | Effect |
|-------|---------|--------|
| `activityTrackingEnabled` | true | Foreground window title/process |
| `activityAllowlist` | `""` | Restrict tracked processes |
| `codingProcessAllowlist` | `""` | Extra coding process patterns |
| `distractorProcessAllowlist` | `""` | Distraction detection |
| `clipboardObservationEnabled` | false | Legacy: error/stacktrace notes in working memory |
| `clipboardFullCaptureEnabled` | true | Proactive-first classification + secret redaction of clipboard changes locally (~8 h) |
| `advisorEnabled` | true | Signal-driven programmer advisor (rest, debug, focus) |
| `ideAdvisorEnabled` | true | Start the local IDE Bridge for proactive coding advice; it can be disabled manually |

## Initiative and reminders

| Field | Default | Effect |
|-------|---------|--------|
| `proactiveEnabled` | true | Master initiative toggle |
| `proactiveSmalltalkIntervalMinutes` | 3 | Base interval for smalltalk/check-ins (scaled by level) |
| `proactiveAdviceIntervalMinutes` | 5 | Base interval for practical advice attempts (scaled by level) |
| `proactiveIntervalMinutes` | 5 | Legacy alias kept for migration; mirrors advice interval |
| `proactiveOpenChat` | true | Open chat on proactive message |
| `initiativeLevel` | `active` | `silent` / `rare` / `normal` / `active` — scales frequency; `active` ≠ advice-only |
| `eventReactionsEnabled` | true | Window/session reactions |
| `remindersEnabled` | true | Due task reminders |
| `quietHoursStart` | 23 | Quiet hours start (hour) |
| `quietHoursEnd` | 8 | Quiet hours end |
| `adaptiveInitiativeEnabled` | false | Online logistic learning |
| `intentClassifierEnabled` | true | Regex intent for modes/rerank |
| `moodEngineEnabled` | true | Enable coordinate mood engine (prompt/style + event updates) |
| `adviceCodeReadingEnabled` | true | Allow Ari to read the current file from the active ProjectBinder (sandboxed) to give code-grounded advice |

### Advice vs smalltalk balance

Advice and smalltalk use independent clocks. A failed advice attempt backs off only advice; it does not consume the smalltalk slot. When both clocks are ready, high-urgency advice can preempt, otherwise smalltalk wins if advice has recently dominated.

Tone is still derived from activity signals:

| Signal | Typical tone |
|--------|----------------|
| Stacktrace / stuck / repeated error | Advice |
| Generic IDE session, no debug signals | Smalltalk check-in |
| Social / memory / return topics | Smalltalk |
| Low advice urgency + recent advice | Smalltalk wins tick |

`initiativeLevel: active` increases check-in frequency; it does **not** force advice on every tick. Cooldowns control pacing, but there is no hard daily or per-kind shutdown; see `docs/METRICS.md`.

## Memory

| Field | Default | Effect |
|-------|---------|--------|
| `userMemoryEnabled` | true | Long-term fact extraction |

## Vision

| Field | Default | Effect |
|-------|---------|--------|
| `visionSource` | `ollama` | `gigachat` or `ollama`; local by default |
| `visionModel` | `qwen2.5vl:7b` | Ollama vision model |
| `visualMemoryMinutes` | 10 | How long observation text persists |
| `autoVisionEnabled` | false | Auto screen glance initiative |

## Personality

| Field | Default | Effect |
|-------|---------|--------|
| `userName` | `""` | User name in prompts |
| `ariTone` | `balanced` | `softer`, `sharper`, `quieter`, `technical` |
| `teasingLevel` | `normal` | `low`, `normal`, `high` |
| `warmthLevel` | `normal` | Prompt warmth |
| `technicalDetail` | `balanced` | Answer depth hint |
| `romanceMode` | `subtle` | `disabled`, `subtle`, `allowed` |
| `nightBehavior` | `normal` | `quiet` or `normal` at night |

## Pomodoro and quiet mode

| Field | Default | Effect |
|-------|---------|--------|
| `pomodoroEnabled` | true | Pomodoro timer |
| `pomodoroFocusMinutes` | 25 | Focus phase length |
| `pomodoroBreakMinutes` | 5 | Break length |
| `quietMode` | `off` | Manual/process/until quiet |
| `quietModeUntil` | — | Timestamp for `until` |
| `quietModeProcess` | — | Process name for `process` |

## Voice (blip)

| Field | Default | Effect |
|-------|---------|--------|
| `voiceStyle` | `blip` | `blip` or `off` |
| `blipVolume` | 0.35 | Volume |
| `blipPitch` / `blipSpeed` | 1.0 | Pitch and speed |
| `blipEmotionPitch` | true | Emotion affects pitch |
| `blipSpeakReplies` | true | Speak assistant replies |
| `blipSpeakInitiative` | false | Speak proactive lines |
| `blipSpeakPomodoro` | true | Speak pomodoro cues |
| `blipShortRepliesOnly` | false | Only short replies |
| `blipMuteDuringFocus` | true | Mute in focus |
| `blipMuteAtNight` | true | Mute at night |
| `blipMuteInQuietMode` | true | Mute in quiet mode |
| `blipMaxReplyChars` | 400 | Max chars to speak |

## Other

| Field | Default | Effect |
|-------|---------|--------|
| `safeActionsEnabled` | true | Safe action proposals |
| `soundsEnabled` | true | UI sounds |
| `webToolsEnabled` | true | Live search/fetch for current proactive advice; requests leave the device |
| `avatarLivelinessEnabled` | true | Micro-reactions, motion |
| `autoUpdateEnabled` | false | In-app updater |
| `onboardingCompleted` | false | Skip onboarding wizard |
| `privacyConsentVersion` | 2 | Internal compatibility marker for settings migration |

## Migrations

### Legacy TTS → blip

`migrateLegacyTts` maps old `tts*` fields to `blip*`.

### proactive-first-v4

One-time migration enables proactive messages, event reactions, activity tracking,
the programmer advisor, clipboard context, and live web tools. It selects the active
initiative level, caps advice at 5 minutes and smalltalk at 3 minutes for existing
installations; later manual setting changes are preserved.

## Model routing

`resolveModel(task, settings)` in `src/llm/modelRouter.ts`:

| Task | Resolution |
|------|------------|
| `chat` | `gigaChatModel` or `model` |
| `json`, `validator`, `initiativeGate` | `fastJsonModel` or main |
| `memoryExtraction`, `summarization` | `memoryModel` or main |
| `vision` | `resolveVisionModel` |
| `embedding` | `resolveEmbeddingModel` |

Companion preset (onboarding/settings): enables memory, initiative, reminders, activity, event reactions, `initiativeLevel: active`, with 3/5-minute base clocks. Copy describes advice on errors/stuck and smalltalk in pauses.
