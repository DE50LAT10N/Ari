import type { AppSettings } from "../settings/appSettings";
import {
  selectUserMemoryContext,
  type UserMemoryFact,
} from "./userMemory";
import { selectOpenTaskContext } from "../tasks/taskStore";
import {
  selectEpisodicContext,
  type MemoryEpisode,
} from "./episodicMemory";
import { canUseInitiativeKind } from "../character/initiativeKinds";
import { getActiveFocusSession } from "../character/focusSession";
import {
  buildProactiveInitiativePackage,
  type MemorySnippet,
  type ProactiveInitiativePackage,
  type ProactivePackageOptions,
} from "../character/initiativeContext";

export type { MemorySnippet };

export function pickMemorySnippet(
  facts: UserMemoryFact[],
  episodes: MemoryEpisode[],
  openTasks: ReturnType<typeof selectOpenTaskContext>,
  query: string,
): MemorySnippet | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scoreText = (text: string): number => {
    const lower = text.toLowerCase();
    return words.reduce(
      (sum, word) => sum + (lower.includes(word) ? 1 : 0),
      0,
    );
  };

  const rankedFacts = facts
    .filter((entry) => !entry.supersededAt && entry.text.length >= 8)
    .map((fact) => ({ fact, score: scoreText(fact.text) }))
    .sort((left, right) => right.score - left.score);
  if (rankedFacts[0]?.score > 0 || rankedFacts[0]) {
    const best = rankedFacts[0];
    if (best) {
      return { text: best.fact.text, kind: "fact" };
    }
  }

  const rankedEpisodes = episodes
    .map((episode) => ({
      episode,
      score: scoreText(`${episode.title} ${episode.text}`),
    }))
    .sort((left, right) => right.score - left.score);
  if (rankedEpisodes[0]) {
    const best = rankedEpisodes[0];
    return {
      text: `${best.episode.title}: ${best.episode.text}`.slice(0, 240),
      kind: "episode",
    };
  }

  const loop = openTasks[0];
  if (loop) {
    return { text: loop.notes ?? loop.title, kind: "loop" };
  }

  return null;
}

export async function buildMemoryCallbackPackage(
  settings: AppSettings,
  queryHint = "",
  bundleOptions: ProactivePackageOptions = {},
): Promise<ProactiveInitiativePackage | null> {
  if (!settings.userMemoryEnabled || !canUseInitiativeKind("memory_callback")) {
    return null;
  }

  const query =
    queryHint.trim() ||
    "недавний разговор личные предпочтения цели проекты привычки";

  const [{ facts, summaries }, episodic] = await Promise.all([
    selectUserMemoryContext(query, 6, 2, settings),
    selectEpisodicContext(query, settings),
  ]);

  const snippet = pickMemorySnippet(
    facts,
    episodic.episodes,
    selectOpenTaskContext(query),
    query,
  );
  if (!snippet) {
    return null;
  }

  const summaryHint = summaries[0]
    ? `Контекст: ${summaries[0].title} — ${summaries[0].text.slice(0, 120)}.`
    : undefined;

  return buildProactiveInitiativePackage(settings, "memory_callback", {
    ...bundleOptions,
    memorySnippet: { ...snippet, summaryHint },
  });
}

export function buildDistractionPackage(
  settings: AppSettings,
  input: {
    app: string;
    title?: string;
    interruptionCount?: number;
    distractionCountToday?: number;
  },
  bundleOptions: ProactivePackageOptions = {},
): ProactiveInitiativePackage | null {
  if (!canUseInitiativeKind("distraction_nudge")) {
    return null;
  }

  const session = getActiveFocusSession();
  const place = [input.app, input.title].filter(Boolean).join(" — ");

  return buildProactiveInitiativePackage(settings, "distraction_nudge", {
    ...bundleOptions,
    distractionPlace: [
      place.slice(0, 120),
      session?.goal ? `Цель фокуса: «${session.goal.slice(0, 120)}».` : "",
      input.distractionCountToday && input.distractionCountToday > 1
        ? `Это уже ${input.distractionCountToday}-я отвлечка на ${input.app} сегодня.`
        : "",
      input.interruptionCount && input.interruptionCount > 2
        ? `Прерываний в сессии: ${input.interruptionCount}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  });
}
