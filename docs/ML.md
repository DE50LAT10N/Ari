# ML and AI techniques

Reference implementation paths under `src/`.

## Retrieval pipeline

1. **Embed query** — `embedQueryCached` (`llm/embeddingCache.ts`); TTL from `embeddingQueryCacheTtlSec`.
2. **Search** — cosine similarity; linear scan or IVF when ≥500 vectors (`memory/ivfIndex.ts`: 32 buckets, 4 probes, 8 k-means iterations).
3. **Score** — hybrid lexical + semantic (`memory/memoryScoring.ts`):

   `mixedRecallScore = w_lex * norm(lexical/3) + w_sem * cosine`

   Defaults: 0.4 / 0.6 (`recallLexicalWeight`, `recallSemanticWeight`).

4. **Rerank** — MMR λ=0.7 (`memory/rerank.ts`); optional LLM listwise rerank for RAG (`memory/llmRerank.ts`, gate in `shouldLlmRerank.ts`).
5. **Orchestration** — `applyRetrievalRerank` (`memory/retrievalRerank.ts`); telemetry in `retrievalTelemetry.ts`.

### Fact ranking (userMemory)

```
score = recall×10 + importance×4 + confidence×2 + freshness + unconsolidated_bonus + 1/(index+1)
```

Filter: `recall ≥ memoryRelevanceFloor` OR `lexical ≥ 0.5`.

### Episode ranking (episodicMemory)

Top 6 by mixed recall + freshness + position tie-break.

## Adaptive initiative

**Rule gate** (`initiativeScoring.ts` → `scoreInitiativeLocally`):

- Risk from scene, daily cap, ignored count, recent activity.
- Value from regex on description, open loops, intent.
- Allow if `rank(value) - rank(risk) > -riskTolerance + moodBias`.

**Online logistic regression** (when `adaptiveInitiativeEnabled`):

```
P(engage) = sigmoid(bias + Σ wᵢ·xᵢ)
allow if P > 0.5
```

SGD update: `η=0.08`, weight clip ±2.5. Labels: user reply = positive; pending expire (15 min) = negative.

**LLM gate** (`initiativeGate.ts`): borderline cases ask JSON `{shouldSend, topic}`.

**Per-kind daily caps** (`initiativeConfig.ts` → `dailyInitiativeKindCap`).

**Relevance ranker** (`relevanceRanker.ts`):

- Scores `try_advice`, `try_smalltalk`, `silent`, and concrete advice candidate kinds with logistic weights.
- Features: active tool family, structured clipboard, diagnostic/error signals, input friction, stuck score, query/task context, cadence skew, LLM availability.
- Advice candidates are reranked after heuristic planning, so the planner still creates safe options while the ranker learns which option is timely.
- Explicit feedback (`useful`, `miss`, `too_generic`, `not_now`) applies a full SGD update.
- Passive outcomes from `adviceOutcome.ts` (`resolved`, `helped`, `ignored`, `stale`, `interrupted`) apply a softer update weighted by confidence, so Ari adapts to real follow-up without overfitting on noisy context changes.
- Learned weights and recent training events are stored locally in `desktop-character.relevance-ranker.v1` and `desktop-character.relevance-ranker-events.v1`.

## Intent classification

Regex rules (`userIntent.ts`): `task_command`, `request_action`, `emotional_support`, `technical_help`, `feedback`, `question`, `smalltalk`. Highest weight wins; confidence = rule weight.

Used by: response modes, initiative features, LLM rerank gate, safe actions.

## Response modes

Priority cascade (`responseModes.ts`): vision → event regex → proactive kind map → proactive → intent map → fallback regex → `casual`.

When `proactive: true`, `proactiveKindToResponseMode(initiativeKind)` selects the tone:

| Initiative kind | Response mode |
|-----------------|---------------|
| `return_reaction` | `return_reaction` |
| `unfinished_thread`, `memory_callback` | `reminder` |
| `process_advice`, `screen_glance` | `technical_help` |
| `break_suggestion`, `distraction_nudge` | `emotional_support` |
| other proactive kinds | `idle_initiative` |

Modes affect system prompt instructions via `describeResponseMode`. Proactive liveliness hints come from `describeProactiveLiveliness` in `proactiveLiveliness.ts`.

## Mood and emotion

**Mood** (`mood.ts`): 3 axes [0,1]; exponential decay (~4h half-life); daily hash drift; interaction shifts (`click`, `return`, `chat_positive`, `ignored_initiative`, etc.).

**Mood engine** (`moodEngine/*`): config-driven coordinate vector (axes table), event→impact layer (reuses shift tables), deterministic decay+clamp update, and classification into existing 18 emotions and `MoodArchetype`. State persists in `desktop-character.ari-mood-engine.v2` while keeping legacy `desktop-character.ari-mood.v1` updated for compatibility.

**Emotion biasing** (`emotionPresentation.ts`): `biasEmotionByMood`, `softenEmotionForMood`, `fuseRelationshipMoodEmotion`.

**Anti-repeat** (`emotionHistory.ts`): last 4 emotions in prompt hint via `describeEmotionAntiRepeat`.

**Transitions** (`emotionTransitions.ts`): allowed paths between emotions; bridge timing.

## Memory extraction

- **Facts** (`memoryExtractor.ts`): post-reply JSON extraction; policy in `memoryPolicy.ts` (auto-commit if core/important + confidence ≥0.85).
- **Episodes** (`episodeExtractor.ts`): narrative + open loops + resolved IDs.
- **Consolidation** (`memoryConsolidator.ts`): at 100 facts → thematic summaries.
- **Conflict** (`memoryConflictResolver.ts`): token overlap + update markers → replace/merge/ask_user.

## Prompt engineering

- **Builder** (`promptBuilder.ts`): character card + runtime context blocks.
- **Safety** (`promptSafety.ts`): sanitize/wrap untrusted memory and RAG.
- **Validation** (`responseValidation.ts`): regex OOC checks (identity leak, false vision claims).
- **Pipeline** (`replyPipeline.ts`): process → retry with correction message → in-character fallback.
- **Trim** (`contextTrim.ts`, `contextBudget.ts`): fit history to token budget after prompt overhead.

## Vision

One-shot multimodal call (`visionClient.ts`); low temperature (0.2); redaction via prompt instruction only.

## Model routing

`resolveModel(task, settings)` (`modelRouter.ts`):

| Task | Model |
|------|-------|
| chat | main chat model |
| json, validator, initiativeGate | fastJsonModel or main |
| memoryExtraction, summarization | memoryModel or main |
| vision | vision model |
| embedding | embedding model |

See [CONFIGURATION.md](CONFIGURATION.md) and [METRICS.md](METRICS.md).
