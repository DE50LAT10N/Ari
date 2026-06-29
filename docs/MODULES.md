# Module reference

Function-level index for `src/**/*.ts`. Internal-only files marked *(internal)*.

## `src/app/`

| Module | Exports / purpose |
|--------|-------------------|
| `App.tsx` | Root shell, avatar, chat, tray integration |
| `ChatPanel.tsx` | Chat UI, streaming, initiative timers, vision |
| `SettingsPanel.tsx` | Settings dialog, diagnostics |
| `MemoryPanel.tsx` | Memory CRUD UI |
| `AriTaskBoard.tsx` | Inline task board beside avatar |
| `OnboardingPanel.tsx` | First-run wizard |
| `Avatar.tsx` | Sprite renderer wrapper |
| `VisionCropper.tsx` | Region select for vision |
| `windowPosition.ts` | `restoreWindowLayout`, min/default sizes |
| `avatarMotion.ts` | `useAvatarMotion`, proximity constants |
| `settingsCategoryIds.ts` | Settings category expand state |
| `idleActions.ts` | Avatar idle animation actions |

## `src/chat/`

| Module | Exports |
|--------|---------|
| `chatHistory.ts` | `loadChatHistory`, `saveChatHistory` |
| `chatCommands.ts` | `tryHandleChatCommand`, command types |
| `taskChatParse.ts` | `tryHandleTaskChatCommand`, `parseTaskTitleAndDue` |
| `commandCharacterWrap.ts` | `wrapCommandReply` |
| `capabilitiesOverview.ts` | `buildCapabilitiesOverview` |
| `contextBudget.ts` | `fitHistoryToTokenBudget`, token estimates |
| `contextTrim.ts` | `buildTrimmedPromptContext` |

## `src/character/`

| Module | Exports |
|--------|---------|
| `mood.ts` | `CharacterMood`, `loadMood`, `applyInteractionToMood`, `describeMoodForPrompt` |
| `relationship.ts` | Bond levels, `loadRelationship`, milestones |
| `relationshipTone.ts` | `deriveRelationshipTone`, tone constraints |
| `emotionHistory.ts` | `recordEmotion`, `describeEmotionAntiRepeat` |
| `emotionPresentation.ts` | `biasEmotionByMood`, `inferEmotionFromReply` |
| `emotionTransitions.ts` | Transition graph, `emotionTransitionPath` |
| `emotionTags.ts` | Parse/strip `<emotion>` tags |
| `emotionAssets.ts` | Sprite path resolution |
| `emotionVoiceProfiles.ts` | Blip pitch profiles |
| `initiativeScoring.ts` | Local/adaptive scoring, pending tracking |
| `initiativeContext.ts` | `buildInitiativeSignalBundle`, `buildProactiveInitiativePackage`, `resolveInitiativeAnchor` |
| `proactiveLiveliness.ts` | `describeProactiveLiveliness`, character voice for proactive replies |
| `initiativeConfig.ts` | Intervals, caps, risk tolerance |
| `initiativeKinds.ts` | Kind cooldowns, `classifyInitiativeKind` |
| `initiativeGate.ts` | `shouldSendInitiative` LLM gate |
| `scenarioEngine.ts` | `resolveScenario`, scenario definitions |
| `scenarioPacks.ts` | JSON packs, `pickPackReaction` |
| `idleLines.ts` | `chooseIdleLine` |
| `dailyRituals.ts` | `getPendingDailyRitual`, `describeRitualTone` |
| `presence.ts` | `derivePresenceScene`, `MicroReaction` |
| `attention.ts` | `deriveAttentionState` |
| `lifecycle.ts` | `deriveLifecycleState`, `blocksInitiative` |
| `interruptibility.ts` | `deriveInterruptibility`, tier gating |
| `proactiveState.ts` | Topic memory, proactive clock |
| `responseModes.ts` | `classifyResponseMode`, mode descriptions |
| `userIntent.ts` | `classifyUserIntent` |
| `promptBuilder.ts` | `buildMessages`, `RuntimeContext` |
| `promptSafety.ts` | `sanitizeUntrusted`, `wrapUntrusted` |
| `responseValidation.ts` | OOC validation rules |
| `replyPipeline.ts` | `processModelReply`, retry/fallback |
| `characterCard.ts` | Static persona text |
| `selfMemory.ts` | Ari self-model localStorage |
| `phraseMemory.ts` | Recent phrase anti-repeat |
| `avoidPhraseBuilder.ts` | Prompt avoid list |
| `pomodoro.ts` | Pomodoro state machine |
| `focusSession.ts` | Focus session CRUD |
| `focusPreferences.ts` | Session duration hints |
| `advisorContext.ts` | `buildAdvisorContext`, derived advisor flags |
| `advisorEngine.ts` | `selectAdvisorAngle`, `buildAdvisorAngleIntent`, `buildConversationTopics`, `pickPlannedInitiativeAnchor` |
| `focusRecap.ts` | End-of-focus summary |
| `routines.ts` | `describeRoutineContext`, activity sessions |
| `reminders.ts` | Quiet hours, time formatting |
| `quietMode.ts` | Quiet mode resolution |
| `notifications.ts` | Toast queue |
| `soundDesign.ts` | UI sound playback |
| `blipVoiceManager.ts` | Stream blip synthesis |
| `blipBank.ts`, `blipSyllables.ts`, `blipTextUtils.ts` | Blip audio |
| `textRevealEngine.ts` | Typewriter effect |
| `characterRenderer.ts` | Canvas sprite renderer |
| `reactionRouter.ts` | Route reactions to overlays |
| `silentReactions.ts` | `buildSilentMicroReaction` |
| `pcReactionCatalog.ts` | PC event reactions |
| `reactionTiming.ts` | Overlay durations |
| `liveStatus.ts` | Status line builder |
| `projectBinder.ts` | Project binders, file read |
| `ariBacklog.ts` | Backlog shim over tasks |
| `datetime.ts` | Russian date/time format |
| `initiativeGate.ts` | LLM relevance gate |

## `src/llm/`

| Module | Exports |
|--------|---------|
| `llmClient.ts` | `streamLlm`, `completeLlmJson` |
| `localLlmClient.ts` | Ollama streaming/JSON |
| `gigaChatClient.ts` | GigaChat API, token cache |
| `gigaChatStatus.ts` | Online/auth state |
| `gigaChatHttp.ts` | HTTP helpers |
| `modelRouter.ts` | `resolveModel`, `ModelTask` |
| `embeddingConfig.ts` | Embedding source resolution |
| `embeddingCache.ts` | Query embedding cache |
| `visionConfig.ts` | Vision source/model |
| `visionClient.ts` | `analyzeScreenCapture`, compare |
| `visionModes.ts` | Mode prompts |
| `providerOnline.ts` | `isLlmProviderOnline` |
| `ollamaCatalog.ts` | Model name matching |
| `ollamaErrors.ts` | Error formatting |

## `src/memory/`

| Module | Exports |
|--------|---------|
| `userMemory.ts` | Facts, summaries, `selectUserMemoryContext` |
| `episodicMemory.ts` | Episodes, `selectEpisodicContext` |
| `memoryExtractor.ts` | LLM fact extraction |
| `episodeExtractor.ts` | LLM episode extraction |
| `memoryPolicy.ts` | Auto-commit rules |
| `memoryConsolidator.ts` | Summary generation |
| `memoryConflictResolver.ts` | `resolveMemoryConflict` |
| `memorySemanticIndex.ts` | Embedding index for memory |
| `memoryScoring.ts` | Tokenize, cosine, mixed recall |
| `memoryProactive.ts` | `buildMemoryCallbackPackage`, `buildDistractionPackage`, `pickMemorySnippet` |
| `activitySignals.ts` | Ring-buffer activity signals (clipboard, focus, queries) |
| `memoryTelemetry.ts` | Health snapshot |
| `retrievalRerank.ts` | `applyRetrievalRerank` |
| `retrievalTelemetry.ts` | Pass recording |
| `rerank.ts` | `mmrRerank`, dedupe |
| `llmRerank.ts` | LLM listwise rerank |
| `shouldLlmRerank.ts` | Rerank gate |
| `ivfIndex.ts` | IVF build/search constants |
| `ivfStore.ts` | Persisted IVF payloads |
| `ariInbox.ts` | Unified inbox items |
| `workingMemory.ts` | Short-term events |
| `activityTimeline.ts` | Timeline events |
| `reviewAggregator.ts` | Daily/weekly review data |
| `reviewSynthesizer.ts` | LLM review text |
| `decisionRecords.ts` | Decision log |
| `userPreferenceRules.ts` | Teach Ari rules |

## `src/rag/`

| Module | Exports |
|--------|---------|
| `ragClient.ts` | `searchRag`, `indexDocument`, `embedTexts` |
| `ragStore.ts` | IndexedDB chunk storage |
| `pdfTextExtractor.ts` | PDF → text |

## `src/tasks/`

| Module | Exports |
|--------|---------|
| `taskStore.ts` | Full task CRUD, due, snooze, events |
| `taskMigration.ts` | Legacy → unified migration |

## `src/tools/`

| Module | Exports |
|--------|---------|
| `safeActions.ts` | Proposal types, execute, log |
| `liveTools.ts` | Web search/fetch planning |

## `src/platform/`

| Module | Exports |
|--------|---------|
| `activeWindow.ts` | Foreground window info |
| `windowContext.ts` | Coding/distracting detection |
| `screenCapture.ts` | Screen capture for vision |
| `userActivity.ts` | Typing/companion interaction |
| `userIdle.ts` | System idle seconds |
| `clipboard.ts` | Clipboard read, `classifyClipboardText` |
| `secretRedaction.ts` | `redactSecrets` before storage/LLM |
| `dataBackup.ts` | Export/import ZIP |
| `autostart.ts` | Windows autostart |
| `gigaChatCredentials.ts` | DPAPI key storage |
| `projectCompanion.ts` | Git read-only commands |
| `logger.ts` | `ariLog` |
| `jsonStorage.ts`, `jsonStorageCache.ts` | JSON persistence helpers |
| `webTools.ts` | DuckDuckGo fetch |
| `ollamaEnvironment.ts`, `ollamaProcess.ts` | Ollama lifecycle |
| `appUpdater.ts`, `appVersion.ts` | Updater/version |

## `src/settings/`

| Module | Exports |
|--------|---------|
| `appSettings.ts` | `AppSettings`, `defaultSettings`, load/save |

## `src/types/`

| Module | Exports |
|--------|---------|
| `character.ts` | `CharacterEmotion`, states |
| `chat.ts` | `ChatMessage` types |

---

For behaviour details see [FEATURES.md](FEATURES.md), [ML.md](ML.md), [METRICS.md](METRICS.md).
