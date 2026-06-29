# Metrics, telemetry, and constants

## Retrieval telemetry

**File:** `src/memory/retrievalTelemetry.ts`  
**Storage:** `desktop-character.retrieval-telemetry.v1` (last 12 passes)

### Per-pass fields (`RetrievalPassRecord`)

| Field | Meaning |
|-------|---------|
| `query` | Query text (truncated at record site) |
| `ragIn` / `ragOut` | RAG candidates before/after rerank |
| `factsIn` / `factsOut` | Fact candidates before/after |
| `episodesIn` / `episodesOut` | Episode candidates before/after |
| `searchMode` | `linear`, `ivf`, or `none` |
| `mmrApplied` | MMR ran |
| `llmRerankApplied` | LLM rerank ran (RAG only) |
| `ms` | Wall time |

### Aggregates (`getRetrievalHealthSnapshot`, last 5 passes)

- `avgShrinkRatio` — output/input ratio across all channels
- `ivfShare` — fraction using IVF
- `mmrShare` — fraction with MMR

**Surfaced in:** Settings → Diagnostics → retrieval section.

## Memory telemetry

**File:** `src/memory/memoryTelemetry.ts`

| Function | Records |
|----------|---------|
| `recordMemoryAutoCommit` | Auto-committed fact snippets |
| `recordMemoryInboxCandidate` | Inbox candidates |
| `recordContextTrim` | Prompt context trim notes |
| `recordInitiativeSuppressed` | Why initiative was blocked |

**Snapshot** (`getMemoryHealthSnapshot`):

- `autoCommitsToday`, `lastAutoCommits`
- `lastInboxCandidates`, `lastContextTrims`
- `initiativesToday` (from initiative daily counter)
- `lastSuppressions`

**Surfaced in:** Settings → Diagnostics.

## Scoring formulas

### Mixed recall

```
normLex = min(1, lexical / 3)
mixed = w_lex * normLex + w_sem * semantic
```

Default weights: 0.4 / 0.6.

### Freshness

```
bonus = max(0, 2.5 - ageDays * 0.12)
```

### Memory conflict similarity

```
similarity = |intersection| / min(|A|, |B|)
```

Thresholds: candidate ≥ **0.48**; merge ≥ **0.82**; ask_user ≥ **0.55**.

## Initiative metrics

| Constant | Value | Location |
|----------|-------|----------|
| Learning rate | 0.08 | `initiativeScoring.ts` |
| Weight clip | ±2.5 | `initiativeScoring.ts` |
| Ignored window | 90 min | pending count window |
| Pending expire | 15 min | negative label |
| Sigmoid threshold | 0.5 | allow/deny |

### Default adaptive weights

| Weight | Value |
|--------|-------|
| bias | -0.15 |
| risk | -0.9 |
| value | +0.85 |
| sceneFocus | -0.35 |
| sceneNight | -0.2 |
| hour | +0.05 |
| mood | +0.4 |
| ignored | -0.7 |
| intent | +0.25 |

### Daily caps by initiative level

| Level | Total/day |
|-------|-----------|
| silent | 2 |
| rare | 3 |
| normal | 4 |
| active | 7 |

Per-kind caps scale from base in `initiativeConfig.ts` (e.g. `memory_callback`: 1 at normal).

## Retrieval constants

| Constant | Value |
|----------|-------|
| IVF build threshold | 500 vectors |
| IVF buckets | 32 |
| IVF probes | 4 |
| K-means iterations | 8 |
| MMR λ | 0.7 |
| Chunk size / overlap | 1200 / 200 |
| Embed batch | 16 |
| LLM rerank shortlist | 12 |
| LLM rerank max tokens | 180 |
| Query cache size | 32 entries |
| `ragScoreThreshold` default | 0.2 |
| `memoryRelevanceFloor` default | 0.12 |
| Semantic threshold (memory index) | 0.18 |

### LLM rerank trigger (`shouldLlmRerank`)

- Query length > 80 chars, OR
- Top-3 score margin < 0.05, OR
- Technical intent (if classifier enabled)

## Where to look in UI

**Settings → Diagnostics:** provider status, memory counts, RAG stats, auto-commits, initiative count, suppressions, retrieval pass summary, context trims.
