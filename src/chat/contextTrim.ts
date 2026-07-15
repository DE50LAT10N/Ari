import type { RuntimeContext } from "../character/promptBuilder";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import { overlapScore, queryWordSet } from "../memory/memoryScoring";
import { importanceRank } from "../memory/userMemory";
import {
  computeHistoryBudget,
  estimateMessagesTokens,
  fitHistoryToTokenBudget,
  measurePromptOverhead,
} from "./contextBudget";

export type TrimmedContext = {
  runtimeContext: RuntimeContext;
  fittedHistory: ChatMessage[];
  trimNotes: string[];
};

type FactLike = {
  text: string;
  importance?: "trivial" | "useful" | "important" | "core";
  confidence?: number;
};

function cloneContext(context: RuntimeContext): RuntimeContext {
  return {
    ...context,
    memory: context.memory ? [...context.memory] : undefined,
    userFacts: context.userFacts ? [...context.userFacts] : undefined,
    userFactDetails: context.userFactDetails
      ? [...context.userFactDetails]
      : undefined,
    memorySummaries: context.memorySummaries
      ? [...context.memorySummaries]
      : undefined,
    openLoops: context.openLoops ? [...context.openLoops] : undefined,
    episodes: context.episodes ? [...context.episodes] : undefined,
    avoidPhrases: context.avoidPhrases ? [...context.avoidPhrases] : undefined,
    bannedProactiveTopics: context.bannedProactiveTopics
      ? [...context.bannedProactiveTopics]
      : undefined,
    proactiveAdviceSteps: context.proactiveAdviceSteps
      ? [...context.proactiveAdviceSteps]
      : undefined,
    activeWindow: context.activeWindow ? { ...context.activeWindow } : context.activeWindow,
    screenObservation: context.screenObservation
      ? { ...context.screenObservation }
      : undefined,
    proactiveCodeExcerpt: context.proactiveCodeExcerpt
      ? { ...context.proactiveCodeExcerpt }
      : undefined,
  };
}

type ShrinkCandidate = {
  size: number;
  note: string;
  apply: () => void;
};

type ShrinkableStringKey =
  | "userName"
  | "eventDescription"
  | "initiativeAnchor"
  | "mood"
  | "relationship"
  | "attention"
  | "routine"
  | "scene"
  | "selfMemory"
  | "emotionGuidance"
  | "workSession"
  | "behaviorSettings"
  | "workingMemory"
  | "conversationMemory"
  | "moodTrigger"
  | "liveToolContext"
  | "ariTone"
  | "tonePreferences"
  | "userPreferences"
  | "relationshipToneConstraints"
  | "projectPinnedContext"
  | "goalLedger"
  | "proactiveSignalSummary"
  | "proactiveLinkNarrative"
  | "proactivePracticalHook"
  | "proactiveInitiativeMove"
  | "proactiveNoveltyGuidance"
  | "ragRetrievalStatus"
  | "mentorTaskGoal"
  | "ideMentorEvidence";

const SHRINKABLE_STRING_KEYS: readonly ShrinkableStringKey[] = [
  "userName",
  "eventDescription",
  "initiativeAnchor",
  "mood",
  "relationship",
  "attention",
  "routine",
  "scene",
  "selfMemory",
  "emotionGuidance",
  "workSession",
  "behaviorSettings",
  "workingMemory",
  "conversationMemory",
  "moodTrigger",
  "liveToolContext",
  "ariTone",
  "tonePreferences",
  "userPreferences",
  "relationshipToneConstraints",
  "projectPinnedContext",
  "goalLedger",
  "proactiveSignalSummary",
  "proactiveLinkNarrative",
  "proactivePracticalHook",
  "proactiveInitiativeMove",
  "proactiveNoveltyGuidance",
  "ragRetrievalStatus",
  "mentorTaskGoal",
  "ideMentorEvidence",
];

function shrinkText(text: string): string | undefined {
  const minimumUsefulChars = 96;
  if (text.length <= minimumUsefulChars + 1) {
    return undefined;
  }
  const nextLength = Math.max(
    minimumUsefulChars - 1,
    Math.floor(text.length * 0.55),
  );
  return `${text.slice(0, nextLength).trimEnd()}…`;
}

function shrinkLargestRuntimeValue(context: RuntimeContext): string | null {
  const candidates: ShrinkCandidate[] = [];
  const stringContext = context as RuntimeContext &
    Record<ShrinkableStringKey, string | undefined>;

  for (const key of SHRINKABLE_STRING_KEYS) {
    const value = stringContext[key];
    if (!value) continue;
    candidates.push({
      size: value.length,
      note: key,
      apply: () => {
        stringContext[key] = shrinkText(value);
      },
    });
  }

  context.memory?.forEach((fragment, index) => {
    candidates.push({
      size: fragment.text.length,
      note: "RAG",
      apply: () => {
        const next = shrinkText(fragment.text);
        if (next) {
          context.memory![index] = { ...fragment, text: next };
        } else {
          context.memory!.splice(index, 1);
        }
      },
    });
  });

  context.userFacts?.forEach((fact, index) => {
    candidates.push({
      size: fact.length,
      note: "user facts",
      apply: () => {
        const next = shrinkText(fact);
        if (next) {
          context.userFacts![index] = next;
          if (context.userFactDetails?.[index]) {
            context.userFactDetails[index] = {
              ...context.userFactDetails[index]!,
              text: next,
            };
          }
        } else {
          context.userFacts!.splice(index, 1);
          context.userFactDetails?.splice(index, 1);
        }
      },
    });
  });

  context.memorySummaries?.forEach((summary, index) => {
    candidates.push({
      size: summary.title.length + summary.text.length,
      note: "memory summaries",
      apply: () => {
        const next = shrinkText(summary.text);
        if (next) {
          context.memorySummaries![index] = { ...summary, text: next };
        } else {
          context.memorySummaries!.splice(index, 1);
        }
      },
    });
  });

  context.episodes?.forEach((episode, index) => {
    candidates.push({
      size: episode.title.length + episode.text.length,
      note: "episodes",
      apply: () => {
        const next = shrinkText(episode.text);
        if (next) {
          context.episodes![index] = { ...episode, text: next };
        } else {
          context.episodes!.splice(index, 1);
        }
      },
    });
  });

  context.openLoops?.forEach((loop, index) => {
    candidates.push({
      size: loop.text.length,
      note: "open loops",
      apply: () => {
        const next = shrinkText(loop.text);
        if (next) {
          context.openLoops![index] = { ...loop, text: next };
        } else {
          context.openLoops!.splice(index, 1);
        }
      },
    });
  });

  const stringArrays: Array<{
    values: string[] | undefined;
    note: string;
  }> = [
    { values: context.avoidPhrases, note: "avoid phrases" },
    { values: context.bannedProactiveTopics, note: "banned topics" },
    { values: context.proactiveAdviceSteps, note: "advice steps" },
  ];
  for (const { values, note } of stringArrays) {
    values?.forEach((value, index) => {
      candidates.push({
        size: value.length,
        note,
        apply: () => {
          const next = shrinkText(value);
          if (next) values[index] = next;
          else values.splice(index, 1);
        },
      });
    });
  }

  if (context.screenObservation) {
    const observation = context.screenObservation;
    candidates.push({
      size: observation.text.length,
      note: "screen observation",
      apply: () => {
        const next = shrinkText(observation.text);
        if (next) context.screenObservation = { ...observation, text: next };
        else context.screenObservation = undefined;
      },
    });
  }
  if (context.proactiveCodeExcerpt) {
    const excerpt = context.proactiveCodeExcerpt;
    candidates.push({
      size: excerpt.text.length,
      note: "code excerpt",
      apply: () => {
        const next = shrinkText(excerpt.text);
        if (next) context.proactiveCodeExcerpt = { ...excerpt, text: next };
        else context.proactiveCodeExcerpt = undefined;
      },
    });
  }

  const largest = candidates.sort((left, right) => right.size - left.size)[0];
  if (!largest) {
    return null;
  }
  largest.apply();
  return largest.note;
}

function totalTokens(
  history: ChatMessage[],
  context: RuntimeContext,
): number {
  return measurePromptOverhead(history, context) + estimateMessagesTokens(history);
}

function lastUserQuery(history: ChatMessage[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") {
      return history[index]?.content ?? "";
    }
  }
  return "";
}

function dropLowestScored<T>(
  items: T[],
  scoreOf: (item: T, index: number) => number,
): T[] {
  if (items.length <= 1) {
    return items;
  }
  let lowestIndex = 0;
  let lowestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < items.length; index += 1) {
    const score = scoreOf(items[index]!, index);
    if (score < lowestScore) {
      lowestScore = score;
      lowestIndex = index;
    }
  }
  return items.filter((_, index) => index !== lowestIndex);
}

function factTrimScore(
  fact: string | FactLike,
  queryWords: Set<string>,
  index: number,
): number {
  const text = typeof fact === "string" ? fact : fact.text;
  const importance =
    typeof fact === "string" ? "useful" : fact.importance ?? "useful";
  const confidence = typeof fact === "string" ? 0.7 : fact.confidence ?? 0.7;
  return (
    overlapScore(text, queryWords) * 10 +
    importanceRank(importance) * 3 +
    confidence * 2 +
    1 / (index + 1)
  );
}

export function buildTrimmedPromptContext(
  baseHistory: ChatMessage[],
  runtimeContext: RuntimeContext,
  settings: AppSettings,
): TrimmedContext {
  const trimNotes: string[] = [];
  let context = cloneContext(runtimeContext);
  let fittedHistory = fitHistoryToContextPass(baseHistory, context, settings);
  const queryWords = queryWordSet(lastUserQuery(baseHistory));

  const limit = Math.max(0, settings.contextTokens - settings.maxTokens - 96);
  let tokens = totalTokens(fittedHistory, context);

  while (tokens > limit && (context.openLoops?.length ?? 0) > 1) {
    context.openLoops = dropLowestScored(context.openLoops ?? [], (loop, index) =>
      overlapScore(loop.text, queryWords) * 10 +
      (loop.dueAt ? 4 : 0) +
      1 / (index + 1),
    );
    trimNotes.push("урезаны open loops");
    tokens = totalTokens(fittedHistory, context);
  }

  while (tokens > limit && (context.memorySummaries?.length ?? 0) > 1) {
    context.memorySummaries = dropLowestScored(
      context.memorySummaries ?? [],
      (summary, index) =>
        overlapScore(`${summary.title} ${summary.text}`, queryWords) * 10 +
        1 / (index + 1),
    );
    trimNotes.push("урезаны сводки памяти");
    tokens = totalTokens(fittedHistory, context);
  }

  while (tokens > limit && (context.userFacts?.length ?? 0) > 2) {
    if (context.userFactDetails?.length) {
      context.userFactDetails = dropLowestScored(
        context.userFactDetails,
        (fact, index) => factTrimScore(fact, queryWords, index),
      );
      context.userFacts = context.userFactDetails.map((fact) => fact.text);
    } else {
      context.userFacts = dropLowestScored(
        context.userFacts ?? [],
        (fact, index) => factTrimScore(fact, queryWords, index),
      );
    }
    trimNotes.push("урезаны факты");
    tokens = totalTokens(fittedHistory, context);
  }

  while (tokens > limit && (context.episodes?.length ?? 0) > 1) {
    context.episodes = dropLowestScored(
      context.episodes ?? [],
      (episode, index) =>
        overlapScore(`${episode.title} ${episode.text}`, queryWords) * 10 +
        1 / (index + 1),
    );
    trimNotes.push("урезаны эпизоды");
    tokens = totalTokens(fittedHistory, context);
  }

  while (tokens > limit && (context.memory?.length ?? 0) > 1) {
    const ragFragments = context.memory ?? [];
    context.memory = dropLowestScored(ragFragments, (fragment, index) =>
      overlapScore(fragment.text, queryWords) * 10 + 1 / (index + 1),
    );
    trimNotes.push("урезан RAG");
    tokens = totalTokens(fittedHistory, context);
  }

  let historyTrimPasses = 0;
  while (tokens > limit && fittedHistory.length > 1) {
    historyTrimPasses += 1;
    if (historyTrimPasses > fittedHistory.length + 4) {
      break;
    }
    fittedHistory = fittedHistory.slice(1);
    fittedHistory = fitHistoryToTokenBudget(
      fittedHistory,
      computeHistoryBudget(
        settings,
        measurePromptOverhead(fittedHistory, context),
      ),
    );
    trimNotes.push("урезана история");
    tokens = totalTokens(fittedHistory, context);
  }

  if (tokens > limit && context.proactive && !context.compactRuntime) {
    context.compactRuntime = true;
    trimNotes.push("включён компактный proactive prompt");
    tokens = totalTokens(fittedHistory, context);
  }

  let hardTrimPasses = 0;
  while (tokens > limit && hardTrimPasses < 160) {
    hardTrimPasses += 1;
    const note = shrinkLargestRuntimeValue(context);
    if (!note) break;
    if (!trimNotes.includes(`жёстко урезан контекст: ${note}`)) {
      trimNotes.push(`жёстко урезан контекст: ${note}`);
    }
    fittedHistory = fitHistoryToTokenBudget(
      fittedHistory,
      computeHistoryBudget(
        settings,
        measurePromptOverhead(fittedHistory, context),
      ),
    );
    tokens = totalTokens(fittedHistory, context);
  }

  if (tokens > limit && fittedHistory.length > 0) {
    fittedHistory = [];
    trimNotes.push("история удалена из-за жёсткого лимита контекста");
    tokens = totalTokens(fittedHistory, context);
  }

  if (tokens > limit) {
    trimNotes.push("статическая системная политика превышает лимит контекста");
  }

  return { runtimeContext: context, fittedHistory, trimNotes };
}

function fitHistoryToContextPass(
  history: ChatMessage[],
  context: RuntimeContext,
  settings: AppSettings,
): ChatMessage[] {
  const provisional = history.map(({ role, content }) => ({ role, content }));
  const overhead = measurePromptOverhead(provisional, context);
  const budget = computeHistoryBudget(settings, overhead);
  return fitHistoryToTokenBudget(provisional, budget);
}
