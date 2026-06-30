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
| `gigaChatModel` | `GigaChat` | Main chat (GigaChat) |
| `gigaChatVisionModel` | `GigaChat` | Vision model |
| `gigaChatEmbeddingModel` | `EmbeddingsGigaR` | Embeddings |
| `gigaChatScope` | `GIGACHAT_API_PERS` | API scope |
| `temperature` | 0.7 | LLM temperature |
| `maxTokens` | 1024 | Max reply tokens |
| `contextTokens` | 8192 | Context window budget |

## Embeddings and RAG

| Field | Default | Effect |
|-------|---------|--------|
| `ragEnabled` | false | Enable document RAG |
| `embeddingSource` | `gigachat` | `gigachat`, `ollama`, or `none` |
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
| `clipboardFullCaptureEnabled` | true | Classify + redact clipboard changes locally (~8 h) |
| `advisorEnabled` | true | Signal-driven programmer advisor (rest, debug, focus) |

## Initiative and reminders

| Field | Default | Effect |
|-------|---------|--------|
| `proactiveEnabled` | true | Master initiative toggle |
| `proactiveSmalltalkIntervalMinutes` | 10 | Base interval for smalltalk/check-ins (scaled by level) |
| `proactiveAdviceIntervalMinutes` | 20 | Base interval for practical advice attempts (scaled by level) |
| `proactiveIntervalMinutes` | 20 | Legacy alias kept for migration; mirrors advice interval |
| `proactiveOpenChat` | true | Open chat on proactive message |
| `initiativeLevel` | `normal` | `silent` / `rare` / `normal` / `active` — scales frequency; `active` ≠ advice-only |
| `eventReactionsEnabled` | true | Window/session reactions |
| `remindersEnabled` | true | Due task reminders |
| `quietHoursStart` | 23 | Quiet hours start (hour) |
| `quietHoursEnd` | 8 | Quiet hours end |
| `adaptiveInitiativeEnabled` | false | Online logistic learning |
| `intentClassifierEnabled` | true | Regex intent for modes/rerank |

### Advice vs smalltalk balance

Advice and smalltalk use independent clocks. A failed advice attempt backs off only advice; it does not consume the smalltalk slot. When both clocks are ready, high-urgency advice can preempt, otherwise smalltalk wins if advice has recently dominated.

Tone is still derived from activity signals:

| Signal | Typical tone |
|--------|----------------|
| Stacktrace / stuck / repeated error | Advice |
| Generic IDE session, no debug signals | Smalltalk check-in |
| Social / memory / return topics | Smalltalk |
| Low advice urgency + recent advice | Smalltalk wins tick |

`initiativeLevel: active` increases check-in frequency; it does **not** force advice on every tick. Daily initiative cap in telemetry is informational (`9999`), not a hard user limit — see `docs/METRICS.md`.

## Memory

| Field | Default | Effect |
|-------|---------|--------|
| `userMemoryEnabled` | true | Long-term fact extraction |

## Vision

| Field | Default | Effect |
|-------|---------|--------|
| `visionSource` | `gigachat` | `gigachat` or `ollama` |
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
| `webToolsEnabled` | true | Live search/fetch tools |
| `avatarLivelinessEnabled` | true | Micro-reactions, motion |
| `autoUpdateEnabled` | false | In-app updater |
| `onboardingCompleted` | false | Skip onboarding wizard |

## Migrations

### Legacy TTS → blip

`migrateLegacyTts` maps old `tts*` fields to `blip*`.

### companion-v2

One-time migration (`companion-v2` key): if user had all companion flags off, enables `proactiveEnabled`, `eventReactionsEnabled`, `activityTrackingEnabled`, caps interval at 20 min.

## Model routing

`resolveModel(task, settings)` in `src/llm/modelRouter.ts`:

| Task | Resolution |
|------|------------|
| `chat` | `gigaChatModel` or `model` |
| `json`, `validator`, `initiativeGate` | `fastJsonModel` or main |
| `memoryExtraction`, `summarization` | `memoryModel` or main |
| `vision` | `resolveVisionModel` |
| `embedding` | `resolveEmbeddingModel` |

Companion preset (onboarding/settings): enables memory, initiative, reminders, activity, event reactions, `initiativeLevel: normal`. Copy describes advice on errors/stuck and smalltalk in pauses.
