import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion } from "../types/character";
import type { CharacterMood } from "../character/mood";
import { describeMoodForPrompt } from "../character/mood";
import {
  getCurrentMoodVector,
  isMoodEngineEnabled,
  moodVectorToPrompt,
} from "../character/moodEngine";
import { buildRagSearchPlan, hasDocumentLookupIntent, type RagSearchPlan } from "../rag/ragQueryBuilder";
import { deriveMoodArchetype } from "../character/moodBehavior";
import { describeMoodChatReplyGuidance } from "../character/moodChatDisposition";
import type { AttentionState } from "../character/attention";
import { describeAttention } from "../character/attention";
import type { CharacterRelationship } from "../character/relationship";
import {
  describeBondForPrompt,
  describeRelationship,
} from "../character/relationship";
import {
  deriveRelationshipTone,
  describeRelationshipTone,
  describeRelationshipToneConstraints,
} from "../character/relationshipTone";
import type { PresenceScene } from "../character/presence";
import { describePresenceScene } from "../character/presence";
import {
  buildInitiativeSignalBundle,
} from "../character/initiativeContext";
import type { AdvisorAngle } from "../character/advisorEngine";
import type { ProactiveReplyTone } from "../character/proactiveTone";
import {
  buildProactiveWebSearchQuery,
  classifyProactiveReplyTone,
  hasProactiveDebugSignals,
  shouldProactiveWebSearch,
} from "../character/proactiveTone";
import type { RuntimeContext } from "../character/promptBuilder";
import { buildMessages, buildUserBehaviorBlock } from "../character/promptBuilder";
import { classifyResponseMode } from "../character/responseModes";
import type { ProcessReplyOptions } from "../character/replyPipeline";
import { describeRoutineContext } from "../character/routines";
import { describeAriSelfMemory, type AriSelfMemory } from "../character/selfMemory";
import { describeReactionLearningSummary } from "../character/reactionLearning";
import { describeEmotionAntiRepeat } from "../character/emotionHistory";
import {
  classifyMoodTrigger,
  describeMoodTrigger,
  moodTriggerEmotionHint,
  previewMoodAfterTrigger,
  type MoodTrigger,
} from "../character/moodTriggers";
import { buildAvoidPhrases } from "../character/avoidPhraseBuilder";
import { describeActiveFocusSession, getActiveFocusSession } from "../character/focusSession";
import { applyRetrievalRerank } from "../memory/retrievalRerank";
import type { RetrievalSearchMode } from "../memory/retrievalTelemetry";
import { getMemorySemanticSearchMode } from "../memory/memorySemanticIndex";
import {
  dedupeFactsAgainstSummaries,
  selectUserMemoryContext,
  type UserMemorySummary,
} from "../memory/userMemory";
import { selectEpisodicContext } from "../memory/episodicMemory";
import { recordContextTrim } from "../memory/memoryTelemetry";
import { shouldRetrieveLongTermMemory } from "../memory/conversationMemory";
import { describeWorkingMemory } from "../memory/workingMemory";
import { describeConversationMemory } from "../memory/conversationMemory";
import { describePinnedProjectContext } from "../character/projectBinder";
import { formatGoalLedgerForPrompt } from "../tasks/goalLedger";
import { describePreferenceRules } from "../memory/userPreferenceRules";
import { buildTrimmedPromptContext } from "../chat/contextTrim";
import { estimateMessagesTokens } from "../chat/contextBudget";
import {
  buildMentorModePolicy,
  createMentorTask,
  isEngineeringRequest,
} from "../mentor/mentorModes";
import {
  buildEngineeringMentorContext,
  type EngineeringMentorMode,
} from "../ide/mentorContext";
import type { IdeWorkspaceSnapshot } from "../ide/protocol";
import { isIdeAdvisorSnapshotFresh } from "../ide/snapshotFreshness";
import { isLlmProviderOnline } from "../llm/providerOnline";
import type { LiveToolPlan } from "../tools/liveTools";
import { normalizeDocumentSourceName } from "../rag/ragQueryBuilder";
import {
  loadLiveTools,
  loadProactiveRuntime,
  loadRagClient,
} from "./chatRuntimeLoaders";
import { yieldToMain, withTimeout } from "../platform/asyncTimeout";
import { chooseResponseLength } from "./replyResponseLength";
import {
  previousUserMessageFromHistory,
  shouldContinueOpenTask,
  userPresentedTask as detectUserPresentedTask,
} from "../character/taskShape";
import {
  isExplicitTaskClose,
  syncOpenTaskThread,
} from "../character/openTaskThread";
import type { ReplyGenerationOptions } from "./replyGenerationTypes";
import {
  REPLY_CONTEXT_RETRIEVAL_TIMEOUT_MS,
  REPLY_PROACTIVE_WEB_SEARCH_TIMEOUT_MS,
  REPLY_RERANK_TIMEOUT_MS,
} from "./replyGenerationPolicy";

type LogFn = (message: string, error: unknown) => void;
type AriLogFn = (
  channel: string,
  level: "debug" | "info" | "warn" | "error",
  payload?: Record<string, unknown>,
) => void;

function describeRagRetrievalStatus(input: {
  ragEnabled: boolean;
  memoryQuery: string;
  memory: Array<{ source: string; text: string }>;
  ragSearchError?: string;
  ragChunkCount: number;
  ragSearchPlan?: RagSearchPlan;
  contextResult?: {
    searchQueries?: string[];
    lexicalHits?: number;
  };
}): string | undefined {
  if (!input.ragEnabled || !input.memoryQuery.trim()) {
    return undefined;
  }
  if (input.ragSearchError) {
    return `ошибка: ${input.ragSearchError}`;
  }
  if (input.memory.length > 0) {
    const topSource = input.memory[0]?.source ?? "документ";
    const lexical =
      input.contextResult?.lexicalHits && input.contextResult.lexicalHits > 0
        ? `, lexical: ${input.contextResult.lexicalHits}`
        : "";
    return `найдено ${input.memory.length} фрагм., топ: ${topSource}${lexical}`;
  }
  const queries =
    input.contextResult?.searchQueries?.join(" | ") ??
    input.ragSearchPlan?.queries.join(" | ") ??
    input.memoryQuery.trim();
  return `не найдено (индекс: ${input.ragChunkCount} фрагм., запросы: ${queries})`;
}

function filterRagByExactItemNumber(input: {
  memory: Array<{ source: string; text: string }>;
  plan?: RagSearchPlan;
}): Array<{ source: string; text: string }> {
  const itemNumber = input.plan?.itemNumber;
  if (!itemNumber || input.memory.length <= 1) {
    return input.memory;
  }
  const numberPattern = new RegExp(`(?:^|\\n)\\s*${itemNumber}[.)]\\s`, "im");
  const questionPattern = new RegExp(`вопрос\\s*№?\\s*${itemNumber}\\b`, "i");
  const sourceHint = input.plan?.documentHint
    ? normalizeDocumentSourceName(input.plan.documentHint)
    : undefined;
  const exact = input.memory.filter((fragment) => {
    if (sourceHint) {
      const source = normalizeDocumentSourceName(fragment.source);
      if (!source.includes(sourceHint) && !sourceHint.includes(source)) {
        return false;
      }
    }
    return numberPattern.test(fragment.text) || questionPattern.test(fragment.text);
  });
  return exact;
}

function isQuestionLikeRequest(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return (
    /[?？]/u.test(normalized) ||
    /(?:подскажи|объясни|расскажи|покажи|проверь|что\s+такое|как\s+(?:сделать|работает|исправить)|почему|зачем|когда|где|кто|како[йея]|можешь\s+ли|what|how|why|where|when|explain|review|debug)/iu.test(
      normalized,
    )
  );
}

export type ReplyContextBuilderInput = {
  baseHistory: ChatMessage[];
  options: ReplyGenerationOptions;
  settings: AppSettings;
  activeWindow: ActiveWindowInfo | null;
  ollamaOnline: boolean | null;
  mood: CharacterMood;
  relationship: CharacterRelationship;
  attention: AttentionState;
  scene: PresenceScene;
  selfMemory: AriSelfMemory;
  streamedEmotion: CharacterEmotion;
  setLiveToolStatus: (status: string | null) => void;
  logError: LogFn;
  ariLog: AriLogFn;
  /** Cancels context collection when the originating reply run is stopped/replaced. */
  signal?: AbortSignal;
  /** Latest native-validated IDE snapshot; contents remain untrusted evidence. */
  ideSnapshot?: IdeWorkspaceSnapshot | null;
};

function throwIfContextCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Сбор контекста отменён.", "AbortError");
}

export type ReplyContextBuildResult = {
  fittedHistory: ChatMessage[];
  runtimeContext: RuntimeContext;
  processReplyOptions: ProcessReplyOptions;
  responseMode: ProcessReplyOptions["responseMode"];
  proactiveReplyTone?: ProactiveReplyTone;
  moodForReply: CharacterMood;
  moodTrigger: MoodTrigger;
  moodTriggerDescription?: string;
  hintedEmotion?: CharacterEmotion;
  lastUserMessage: string;
  proactiveLlm: Awaited<ReturnType<typeof loadProactiveRuntime>> | null;
  topOpenLoop?: string;
};

export async function buildReplyContext(
  input: ReplyContextBuilderInput,
): Promise<ReplyContextBuildResult> {
  const {
    baseHistory,
    options,
    settings,
    activeWindow,
    ollamaOnline,
    mood,
    relationship,
    attention,
    scene,
    selfMemory,
    streamedEmotion,
    setLiveToolStatus,
    logError,
    ariLog,
    signal,
    ideSnapshot,
  } = input;

  const proactiveLlm = options.proactive ? await loadProactiveRuntime() : null;
  throwIfContextCancelled(signal);
  const lastUserMessage =
    [...baseHistory].reverse().find(({ role }) => role === "user")?.content ?? "";
  const mentorTask =
    !options.proactive && isEngineeringRequest(lastUserMessage)
      ? createMentorTask(lastUserMessage)
      : null;
  const ideMentorContext =
    mentorTask &&
    ideSnapshot &&
    settings.onboardingCompleted &&
    settings.ideAdvisorEnabled &&
    settings.adviceCodeReadingEnabled &&
    isIdeAdvisorSnapshotFresh(ideSnapshot)
      ? buildEngineeringMentorContext(ideSnapshot, {
          mode: (mentorTask.mode === "implementation"
            ? "mentor_explain"
            : mentorTask.mode) as EngineeringMentorMode,
          maxContentChars: 6_500,
        })
      : null;
  const ideMentorEvidence = ideMentorContext?.evidence.length
    ? JSON.stringify(ideMentorContext)
    : undefined;
  const moodTrigger =
    !options.proactive && !options.screenObservation && lastUserMessage
      ? classifyMoodTrigger(lastUserMessage)
      : classifyMoodTrigger("");
  const moodTriggerDescription = describeMoodTrigger(moodTrigger) ?? undefined;
  const moodForReply = moodTriggerDescription
    ? previewMoodAfterTrigger(mood, moodTrigger)
    : mood;
  const hintedEmotion = moodTriggerEmotionHint(moodTrigger) ?? undefined;

  const proactiveQuery = [
    options.eventDescription,
    options.initiativeKind,
    lastUserMessage,
    activeWindow?.processName,
    activeWindow?.title,
    "недавний разговор и текущая ситуация пользователя",
  ]
    .filter(Boolean)
    .join(" ");
  const newsOnly = Boolean(options.newsItem);
  const memoryQuery = newsOnly ? "" : options.proactive ? proactiveQuery : lastUserMessage;
  const ragSearchPlan =
    !options.proactive && memoryQuery.trim()
      ? buildRagSearchPlan(memoryQuery)
      : undefined;
  const ragEnabledForMessage =
    settings.ragEnabled || Boolean(ragSearchPlan?.explicitRag);
  const retrieveUserMemory =
    settings.userMemoryEnabled &&
    shouldRetrieveLongTermMemory(memoryQuery, {
      proactive: Boolean(options.proactive),
      ragEnabled: ragEnabledForMessage,
    });

  let rawMemory: Awaited<
    ReturnType<Awaited<ReturnType<typeof loadRagClient>>["searchRag"]>
  >["matches"] = [];
  let ragSearchError: string | undefined;
  let ragChunkCount = 0;
  let rawUserMemory: Awaited<ReturnType<typeof selectUserMemoryContext>> = {
    facts: [],
    summaries: [] as UserMemorySummary[],
  };
  let episodicMemory: Awaited<ReturnType<typeof selectEpisodicContext>> = {
    episodes: [],
    openLoops: [],
  };

  if (
    (ragEnabledForMessage || retrieveUserMemory) &&
    memoryQuery.trim()
  ) {
    setLiveToolStatus(
      ragEnabledForMessage ? "ищу в документах..." : "читаю память...",
    );
    await yieldToMain();
    throwIfContextCancelled(signal);
  }

  type ContextBundle = [
    PromiseSettledResult<
      Awaited<ReturnType<Awaited<ReturnType<typeof loadRagClient>>["searchRag"]>>
    >,
    PromiseSettledResult<Awaited<ReturnType<typeof selectUserMemoryContext>>>,
    PromiseSettledResult<Awaited<ReturnType<typeof selectEpisodicContext>>>,
  ];
  const emptyContextResults: ContextBundle = [
    {
      status: "fulfilled",
      value: { matches: [], chunkCount: 0, searchMode: "none" },
    },
    {
      status: "fulfilled",
      value: { facts: [], summaries: [] as UserMemorySummary[] },
    },
    { status: "fulfilled", value: { episodes: [], openLoops: [] } },
  ];
  let contextResults: ContextBundle;
  const ragClient =
    ragEnabledForMessage && memoryQuery.trim() ? await loadRagClient() : null;
  throwIfContextCancelled(signal);
  try {
    contextResults = await withTimeout(
      () => Promise.allSettled([
        ragClient
          ? ragClient.searchRag(memoryQuery, settings, {
              plan: ragSearchPlan,
            })
          : Promise.resolve({
          matches: [],
          chunkCount: 0,
          searchMode: "none" as const,
        }),
        retrieveUserMemory
          ? selectUserMemoryContext(
              memoryQuery,
              options.proactive ? 6 : 8,
              options.proactive ? 2 : 3,
              settings,
            )
          : Promise.resolve({ facts: [], summaries: [] as UserMemorySummary[] }),
        retrieveUserMemory
          ? selectEpisodicContext(memoryQuery, settings)
          : Promise.resolve({ episodes: [], openLoops: [] }),
      ]),
      REPLY_CONTEXT_RETRIEVAL_TIMEOUT_MS,
      "Сбор контекста",
      { signal },
    );
  } catch (contextError) {
    throwIfContextCancelled(signal);
    logError("Context retrieval timed out", contextError);
    contextResults = emptyContextResults;
  }

  if (contextResults[0].status === "fulfilled") {
    rawMemory = contextResults[0].value.matches;
    ragSearchError = contextResults[0].value.error;
    ragChunkCount = contextResults[0].value.chunkCount;
    if (ragSearchError) {
      logError("RAG retrieval error", ragSearchError);
      ariLog("rag", "warn", {
        error: ragSearchError,
        chunkCount: ragChunkCount,
        embeddingModel: contextResults[0].value.embeddingModel,
      });
    }
  } else {
    logError("RAG retrieval failed", contextResults[0].reason);
  }
  if (contextResults[1].status === "fulfilled") {
    rawUserMemory = contextResults[1].value;
  } else {
    logError("User memory retrieval failed", contextResults[1].reason);
  }
  if (contextResults[2].status === "fulfilled") {
    episodicMemory = contextResults[2].value;
  } else {
    logError("Episodic memory retrieval failed", contextResults[2].reason);
  }

  const ragMode = ragClient?.getRagSearchMode() ?? "none";
  const memoryMode = getMemorySemanticSearchMode();
  const searchMode: RetrievalSearchMode =
    ragMode === "ivf" || memoryMode === "ivf"
      ? "ivf"
      : ragMode === "linear" || memoryMode === "linear"
        ? "linear"
        : "none";
  let reranked = {
    rag: rawMemory,
    facts: rawUserMemory.facts,
    episodes: episodicMemory.episodes,
  };
  try {
    reranked = await withTimeout(
      () => applyRetrievalRerank({
        query: memoryQuery,
        settings,
        ragMatches: rawMemory,
        facts: rawUserMemory.facts,
        episodes: episodicMemory.episodes,
        searchMode,
      }),
      REPLY_RERANK_TIMEOUT_MS,
      "Переранжирование",
      { signal },
    );
  } catch (rerankError) {
    throwIfContextCancelled(signal);
    logError("Retrieval rerank failed", rerankError);
  }
  setLiveToolStatus(null);

  const memory = filterRagByExactItemNumber({
    memory: reranked.rag,
    plan: ragSearchPlan,
  });
  const userMemory = {
    facts: dedupeFactsAgainstSummaries(
      reranked.facts,
      rawUserMemory.summaries,
    ),
    summaries: rawUserMemory.summaries,
  };
  const episodicForPrompt = {
    episodes: reranked.episodes,
    openLoops: episodicMemory.openLoops,
  };

  let liveToolContext: string | undefined;
  const ragFound = memory.length > 0;
  const ragRetrievalStatus = describeRagRetrievalStatus({
    ragEnabled: ragEnabledForMessage,
    memoryQuery,
    memory,
    ragSearchError,
    ragChunkCount,
    ragSearchPlan,
    contextResult: contextResults[0].status === "fulfilled"
      ? contextResults[0].value
      : undefined,
  });
  const documentLookupIntent =
    !options.proactive && hasDocumentLookupIntent(lastUserMessage);
  const liveToolsModule =
    settings.webToolsEnabled &&
    isLlmProviderOnline(settings, ollamaOnline) &&
    lastUserMessage.trim()
      ? await loadLiveTools()
      : null;
  throwIfContextCancelled(signal);
  const needsExplicitTool =
    liveToolsModule?.needsExplicitLiveToolPlanner(lastUserMessage) ?? false;
  const needsWebFallback =
    liveToolsModule?.shouldAutoWebSearch(lastUserMessage, {
      ragEnabled: settings.ragEnabled,
      ragMatchCount: memory.length,
    }) ?? false;
  const proactiveReplyTone =
    options.proactiveReplyTone ??
    (options.proactive && options.initiativeKind
      ? classifyProactiveReplyTone({
          initiativeKind: options.initiativeKind,
          advisorAngle: options.advisorAngle as AdvisorAngle | undefined,
          anchor: options.initiativeAnchor,
        })
      : undefined);

  if (
    settings.webToolsEnabled &&
    options.proactive &&
    proactiveReplyTone === "advice" &&
    isLlmProviderOnline(settings, ollamaOnline)
  ) {
    try {
      const proactiveTools = liveToolsModule ?? (await loadLiveTools());
      throwIfContextCancelled(signal);
      const proactiveBundle = buildInitiativeSignalBundle(settings, {
        processName: activeWindow?.processName,
        windowTitle: activeWindow?.title,
      });
      if (
        shouldProactiveWebSearch(
          proactiveBundle,
          proactiveReplyTone,
          settings,
          options.initiativeAnchor,
          options.proactiveAdviceCandidateKind,
        )
      ) {
        const query = buildProactiveWebSearchQuery(
          proactiveBundle,
          options.initiativeAnchor,
        );
        setLiveToolStatus("ищу в интернете...");
        const raw = await withTimeout(
          () => proactiveTools.runLiveTool({ tool: "web_search", query }, settings),
          REPLY_PROACTIVE_WEB_SEARCH_TIMEOUT_MS,
          "Проактивный поиск",
          { signal },
        );
        liveToolContext = proactiveTools.formatLiveToolContext(
          { tool: "web_search", query },
          raw,
        );
      }
    } catch (toolError) {
      throwIfContextCancelled(signal);
      logError("Proactive web search failed", toolError);
    } finally {
      setLiveToolStatus(null);
    }
  }

  if (
    liveToolsModule &&
    settings.webToolsEnabled &&
    !options.proactive &&
    isLlmProviderOnline(settings, ollamaOnline) &&
    lastUserMessage.trim() &&
    (needsExplicitTool || (!ragFound && needsWebFallback))
  ) {
    try {
      let plan: LiveToolPlan | null = null;
      if (needsExplicitTool) {
        plan = await withTimeout(
          () => liveToolsModule.planLiveToolUse(lastUserMessage, settings),
          25_000,
          "Выбор live-инструмента",
          { signal },
        );
      }
      if (!plan && needsWebFallback && !ragFound) {
        plan = {
          tool: "web_search",
          query: lastUserMessage.trim().slice(0, 200),
        };
      }
      if (plan) {
        if (plan.tool === "web_search") {
          setLiveToolStatus("ищу в интернете...");
        }
        const raw = await withTimeout(
          () => liveToolsModule.runLiveTool(plan, settings),
          30_000,
          "Выполнение live-инструмента",
          { signal },
        );
        liveToolContext = liveToolsModule.formatLiveToolContext(plan, raw);
      }
    } catch (toolError) {
      throwIfContextCancelled(signal);
      logError("Live tool failed", toolError);
    } finally {
      setLiveToolStatus(null);
    }
  }

  const moodStyle = isMoodEngineEnabled(settings)
    ? moodVectorToPrompt(getCurrentMoodVector().vector)
    : null;
  const moodPrompt = moodStyle?.promptModifier ?? describeMoodForPrompt(moodForReply);
  const openTaskState = options.proactive
    ? null
    : syncOpenTaskThread({
        lastUserMessage,
        history: baseHistory,
      });
  const stickyOpenTask =
    Boolean(openTaskState) &&
    !options.proactive &&
    !isExplicitTaskClose(lastUserMessage);
  const hasOpenTaskThread =
    stickyOpenTask || shouldContinueOpenTask(lastUserMessage, baseHistory);
  let responseLength = chooseResponseLength(
    lastUserMessage,
    memory.length,
    Boolean(options.proactive),
    proactiveReplyTone,
    moodForReply,
    moodStyle?.responseParams,
    baseHistory,
  );
  if (stickyOpenTask && responseLength === "short") {
    responseLength = "medium";
  }
  let responseMode = classifyResponseMode({
    message: lastUserMessage,
    proactive: options.proactive,
    screenObservation: Boolean(options.screenObservation),
    eventDescription: options.eventDescription,
    initiativeKind: options.initiativeKind,
    proactiveReplyTone,
    useIntentClassifier: settings.intentClassifierEnabled,
    recentHistory: baseHistory,
    hasOpenTaskThread,
  });
  if (stickyOpenTask) {
    responseMode = "technical_help";
  }
  const relationshipToneKey = deriveRelationshipTone(relationship, moodForReply);
  const relationshipTone = describeRelationshipTone(relationshipToneKey);
  const workingMemoryForPrompt = describeWorkingMemory() || undefined;
  const conversationMemoryForPrompt = describeConversationMemory() || undefined;
  const recentAssistantReplies = baseHistory
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .slice(-5);
  const userAskedQuestion = isQuestionLikeRequest(lastUserMessage);
  const previousUserMessage = previousUserMessageFromHistory(
    baseHistory,
    lastUserMessage,
  );
  const userPresentedTask =
    stickyOpenTask ||
    detectUserPresentedTask(
      lastUserMessage,
      previousUserMessage,
      baseHistory,
    );
  const memoryEvidence = [
    ...userMemory.facts.map((fact) => fact.text),
    ...userMemory.summaries.flatMap((summary) => [summary.title, summary.text]),
    ...episodicForPrompt.episodes.flatMap((episode) => [episode.title, episode.text]),
    ...episodicForPrompt.openLoops.map((loop) => loop.text),
    workingMemoryForPrompt,
    conversationMemoryForPrompt,
  ].filter((value): value is string => Boolean(value?.trim()));
  const validationContext = {
    hasVision: Boolean(options.screenObservation),
    hasMemory: memoryEvidence.length > 0,
    memoryEvidence,
    hasRag: memory.length > 0,
    ragEvidence: memory.map((fragment) => fragment.text),
    documentLookupIntent,
    hasLiveTool: Boolean(liveToolContext),
    userAskedQuestion,
    userPresentedTask,
    proactive: Boolean(options.proactive),
    proactiveReplyTone,
    responseMode,
    moodArchetype: deriveMoodArchetype(moodForReply),
    hasDebugSignals:
      Boolean(options.proactive) &&
      proactiveReplyTone === "advice" &&
      hasProactiveDebugSignals(
        buildInitiativeSignalBundle(settings, {
          processName: activeWindow?.processName,
          windowTitle: activeWindow?.title,
        }),
      ),
    proactiveInitiativeMove: options.proactiveInitiativeMove,
    newsEvidence: options.newsItem
      ? {
          title: options.newsItem.title,
          summary: options.newsItem.summary,
          excerpt: options.newsItem.excerpt,
          publisher: options.newsItem.publisher,
          publishedAt: options.newsItem.publishedAt,
        }
      : undefined,
  };
  const processReplyOptions: ProcessReplyOptions = {
    responseMode,
    validationContext,
    streamedEmotion,
    recentAssistantReplies,
    proactive: Boolean(options.proactive),
    userAskedQuestion,
    userPresentedTask,
  };

  let runtimeContext: RuntimeContext = {
    memory,
    activeWindow,
    proactive: options.proactive,
    userFacts: userMemory.facts.map(({ text }) => text),
    userFactDetails: userMemory.facts.map(({ text, importance, confidence }) => ({
      text,
      importance,
      confidence,
    })),
    memorySummaries: userMemory.summaries.map(({ title, text }) => ({
      title,
      text,
    })),
    episodes: episodicForPrompt.episodes,
    openLoops: episodicForPrompt.openLoops,
    eventDescription: options.eventDescription,
    initiativeAnchor: options.initiativeAnchor,
    softInitiativeAnchor: options.softInitiativeAnchor,
    bannedProactiveTopics: options.bannedProactiveTopics,
    mood: moodPrompt,
    relationship: `${describeRelationship(relationship)}. ${describeBondForPrompt(
      relationship,
      settings.romanceMode,
    )}; тон: ${relationshipTone}`,
    relationshipToneConstraints:
      describeRelationshipToneConstraints(relationshipToneKey),
    attention: describeAttention(attention),
    routine: describeRoutineContext(),
    scene: describePresenceScene(scene),
    safeActionsAvailable: settings.safeActionsEnabled,
    responseMode,
    userPresentedTask,
    openTaskExcerpt: stickyOpenTask ? openTaskState?.excerpt : undefined,
    selfMemory: [describeAriSelfMemory(selfMemory), describeReactionLearningSummary()]
      .filter(Boolean)
      .join(". "),
    initiativeKind: options.initiativeKind,
    proactiveReplyTone,
    responseLength,
    screenObservation: options.screenObservation,
    avoidPhrases: buildAvoidPhrases(),
    emotionGuidance:
      [
        describeEmotionAntiRepeat(moodForReply),
        !options.proactive
          ? describeMoodChatReplyGuidance(moodForReply, lastUserMessage)
          : undefined,
      ]
        .filter(Boolean)
        .join("\n") || undefined,
    workSession: describeActiveFocusSession(getActiveFocusSession()),
    behaviorSettings: buildUserBehaviorBlock(settings, describePreferenceRules()) || undefined,
    workingMemory: workingMemoryForPrompt,
    conversationMemory: conversationMemoryForPrompt,
    moodTrigger: moodTriggerDescription,
    liveToolContext,
    newsContext: options.newsItem
      ? [
          `Издатель: ${options.newsItem.publisher}`,
          `Заголовок: ${options.newsItem.title}`,
          `Дата: ${new Date(options.newsItem.publishedAt).toISOString()}`,
          `Краткий факт: ${options.newsItem.summary}`,
          `Фрагмент: ${options.newsItem.excerpt}`,
        ].join("\n")
      : undefined,
    ragRetrievalStatus,
    documentLookupItemNumber: ragSearchPlan?.itemNumber,
    projectPinnedContext: describePinnedProjectContext() || undefined,
    goalLedger: formatGoalLedgerForPrompt() || undefined,
    proactiveSignalSummary: options.proactiveSignalSummary,
    proactiveLinkNarrative: options.proactiveLinkNarrative,
    proactivePracticalHook: options.proactivePracticalHook,
    proactiveAdviceSteps: options.proactiveAdviceSteps,
    proactiveCodeExcerpt: options.proactiveCodeExcerpt,
    proactiveInitiativeMove: options.proactiveInitiativeMove,
    proactiveNoveltyGuidance: options.proactiveNoveltyGuidance,
    mentorModePolicy: mentorTask ? buildMentorModePolicy(mentorTask) : undefined,
    mentorTaskGoal: mentorTask?.goal,
    ideMentorEvidence,
  };
  if (newsOnly) {
    runtimeContext = {
      proactive: true,
      eventDescription: options.eventDescription,
      initiativeAnchor: options.newsItem?.title,
      softInitiativeAnchor: true,
      mood: moodPrompt,
      relationship: runtimeContext.relationship,
      relationshipToneConstraints: runtimeContext.relationshipToneConstraints,
      attention: runtimeContext.attention,
      routine: runtimeContext.routine,
      scene: runtimeContext.scene,
      responseMode,
      initiativeKind: "news_comment",
      proactiveReplyTone: "smalltalk",
      responseLength: "short",
      avoidPhrases: runtimeContext.avoidPhrases,
      emotionGuidance: runtimeContext.emotionGuidance,
      ariTone: runtimeContext.ariTone,
      tonePreferences: runtimeContext.tonePreferences,
      newsContext: runtimeContext.newsContext,
    };
  }
  const fittedBundle = buildTrimmedPromptContext(newsOnly ? [] : baseHistory, runtimeContext, settings);
  const fittedHistory = fittedBundle.fittedHistory;
  runtimeContext = fittedBundle.runtimeContext;
  if (fittedBundle.trimNotes.length) {
    fittedBundle.trimNotes.forEach((note) => recordContextTrim(note));
    ariLog("prompt-context", "debug", {
      contextTrim: fittedBundle.trimNotes.join(", "),
    });
  }

  const tokenEstimate = estimateMessagesTokens(
    buildMessages(fittedHistory, runtimeContext),
  );
  ariLog("prompt-context", "debug", {
    provider: settings.llmProvider,
    responseMode,
    relationshipTone,
    moodSummary: describeMoodForPrompt(mood),
    scene,
    memoryCount: userMemory.facts.length,
    episodeCount: episodicForPrompt.episodes.length,
    ragCount: memory.length,
    tokenEstimate,
    finalUserMessage: lastUserMessage.slice(0, 120),
    initiativeReason: options.eventDescription,
    ideWorkspaceId: ideMentorContext?.project.workspaceId,
    ideSnapshotRevision: ideMentorContext?.project.snapshotRevision,
    ideEvidenceCount: ideMentorContext?.evidence.length ?? 0,
  });
  ariLog("runtime", "debug", {
    emotion: streamedEmotion,
    visualState: "thinking",
    responseMode,
    lastInitiative: options.eventDescription,
  });

  return {
    fittedHistory,
    runtimeContext,
    processReplyOptions,
    responseMode,
    proactiveReplyTone,
    moodForReply,
    moodTrigger,
    moodTriggerDescription,
    hintedEmotion,
    lastUserMessage,
    proactiveLlm,
    topOpenLoop: episodicMemory.openLoops[0]?.text,
  };
}
