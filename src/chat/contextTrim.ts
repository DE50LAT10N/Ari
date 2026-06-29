import type { RuntimeContext } from "../character/promptBuilder";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import { overlapScore, queryWordSet } from "../memory/memoryScoring";
import { importanceRank } from "../memory/userMemory";
import {
  computeHistoryBudget,
  estimateMessagesTokens,
  estimateTextTokens,
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
  };
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

  const limit = settings.contextTokens - settings.maxTokens - 96;
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

  while (tokens > limit && (context.memory?.length ?? 0) > 0) {
    context.memory = dropLowestScored(context.memory ?? [], (fragment, index) =>
      overlapScore(fragment.text, queryWords) * 10 + 1 / (index + 1),
    );
    trimNotes.push("урезан RAG");
    tokens = totalTokens(fittedHistory, context);
  }

  while (tokens > limit && fittedHistory.length > 2) {
    fittedHistory = fitHistoryToTokenBudget(
      fittedHistory.slice(1),
      computeHistoryBudget(
        settings,
        measurePromptOverhead(fittedHistory.slice(1), context),
      ) - estimateTextTokens(fittedHistory[0]?.content ?? ""),
    );
    trimNotes.push("урезана история");
    tokens = totalTokens(fittedHistory, context);
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
