# Mood Engine (coordinate space)

This project already has a mood model (`warmth`, `energy`, `irritation`) and an emotion/sprite system (18 emotions + 2 state overlays). The **mood engine** formalizes mood as a **config-driven coordinate vector**, updated by events and decayed toward a baseline, then classified into the existing categories used by prompts and sprites.

## What it is

- **Mood state**: a numeric vector (default axes: `warmth`, `energy`, `irritation`) in `[-1, 1]`.
- **Axis config**: declarative per-axis bounds, baseline and decay settings.
- **Events**: user actions / trigger detection / assistant emotion transitions → impact vectors.
- **Update engine**: deterministic function applying decay + summed impacts.
- **Classification**: config-driven mapping from vector → existing `CharacterEmotion` (all 18) and existing `MoodArchetype`.
- **Style adapter**: produces a compact prompt modifier that only affects tone/style (never safety/facts/tools).

Source: `src/character/moodEngine/*`.

## Axis configuration

File: `src/character/moodEngine/axisConfig.ts`

`DEFAULT_MOOD_AXES` defines axes declaratively:

- `id`
- `min` / `max`
- `baseline`
- `decayHours`
- optional metadata (`weight`, `description`, `categoryHints`)

### Add a new axis

1. Add an entry to `DEFAULT_MOOD_AXES` (or provide a custom config table).
2. Update any event impact rules that should touch that axis (optional).
3. Add classification rules if you want the axis to affect emotion/archetype selection (optional).

The update engine itself does not need changes to support new axes.

## Events → impacts

Files:
- `src/character/moodEngine/moodEvents.ts`
- `src/character/moodEngine/impactRules.ts`

Events carry `intensity` and `confidence` and can specify:
- `impactRuleId` (recommended) — resolved via `resolveImpactRule`
- or a direct `impact` vector

Existing project shift tables are reused as the single source of truth:
- `EMOTION_MOOD_SHIFTS` and `INTERACTION_MOOD_SHIFTS` from `src/character/mood.ts`
- `MOOD_SHIFT_BY_TRIGGER` from `src/character/moodTriggers.ts`

## Update engine (decay + clamp)

File: `src/character/moodEngine/moodUpdateEngine.ts`

For each axis:

\[
next = clamp\\bigl(baseline + decay\\cdot(old-baseline) + \\sum impact\\cdot intensity\\cdot confidence\\bigr)
\]

- Decay is exponential (`exp(-hours/decayHours)`), disableable for tests.
- Values are clamped to axis min/max and sanitized against NaN/Infinity.

## Classification (uses existing sprites)

File: `src/character/moodEngine/moodClassifier.ts`

- Outputs an existing `CharacterEmotion` (all 18; see `src/types/character.ts`) so every emotion PNG can be reached.
- Outputs an existing `MoodArchetype` via `deriveMoodArchetype` (`src/character/moodBehavior.ts`).

## Integration points

- **Feature flag**: `moodEngineEnabled` in `src/settings/appSettings.ts` (default `true`). Toggle in `src/app/SettingsPanel.tsx`.
- **Prompt**: `ChatPanel.tsx` uses `moodVectorToPrompt(...).promptModifier` when enabled; otherwise uses `describeMoodForPrompt`.
- **State updates**: `App.tsx` routes mood updates for emotion changes, UI interactions, and mood triggers through `updateMoodFromEvents` when enabled. Legacy localStorage key `desktop-character.ari-mood.v1` is kept up-to-date for compatibility.

## Persistence and migration

File: `src/character/moodEngine/moodEngineStore.ts`

- New state: `desktop-character.ari-mood-engine.v2`
- Legacy state kept: `desktop-character.ari-mood.v1` (warmth/energy/irritation)
- v1 → v2 migration happens on load; legacy key is not deleted.

## Safety invariants

Mood is allowed to change only **style**:
- tone, tempo, verbosity hints, emotion hints

Mood must never change:
- facts / correctness policy
- safety/refusal policy
- permission boundaries or tool access
- privacy behavior

