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
import { deriveMoodArchetype } from "../character/moodBehavior";
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
import { buildUserBehaviorBlock } from "../character/promptBuilder";
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
import { isLlmProviderOnline } from "../llm/providerOnline";
import type { LiveToolPlan } from "../tools/liveTools";
import {
  loadLiveTools,
  loadProactiveRuntime,
  loadRagClient,
} from "./chatRuntimeLoaders";
import { yieldToMain, withTimeout } from "../platform/asyncTimeout";
import { chooseResponseLength } from "./replyResponseLength";
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
};

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
  } = input;

  const proactiveLlm = options.proactive ? await loadProactiveRuntime() : null;
  const lastUserMessage =
    [...baseHistory].reverse().find(({ role }) => role === "user")?.content ?? "";
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
  const memoryQuery = options.proactive ? proactiveQuery : lastUserMessage;
  const retrieveUserMemory =
    settings.userMemoryEnabled &&
    shouldRetrieveLongTermMemory(memoryQuery, {
      proactive: Boolean(options.proactive),
      ragEnabled: settings.ragEnabled,
    });

  let rawMemory: Awaited<
    ReturnType<Awaited<ReturnType<typeof loadRagClient>>["searchRag"]>
  > = [];
  let rawUserMemory: Awaited<ReturnType<typeof selectUserMemoryContext>> = {
    facts: [],
    summaries: [] as UserMemorySummary[],
  };
  let episodicMemory: Awaited<ReturnType<typeof selectEpisodicContext>> = {
    episodes: [],
    openLoops: [],
  };

  if (
    (settings.ragEnabled || retrieveUserMemory) &&
    memoryQuery.trim() &&
    !options.proactive
  ) {
    setLiveToolStatus(
      settings.ragEnabled ? "ищу в документах..." : "читаю память...",
    );
    await yieldToMain();
  }

  type ContextBundle = [
    PromiseSettledResult<
      Awaited<ReturnType<Awaited<ReturnType<typeof loadRagClient>>["searchRag"]>>
    >,
    PromiseSettledResult<Awaited<ReturnType<typeof selectUserMemoryContext>>>,
    PromiseSettledResult<Awaited<ReturnType<typeof selectEpisodicContext>>>,
  ];
  const emptyContextResults: ContextBundle = [
    { status: "fulfilled", value: [] },
    {
      status: "fulfilled",
      value: { facts: [], summaries: [] as UserMemorySummary[] },
    },
    { status: "fulfilled", value: { episodes: [], openLoops: [] } },
  ];
  let contextResults: ContextBundle;
  const ragClient =
    settings.ragEnabled && memoryQuery.trim() ? await loadRagClient() : null;
  try {
    contextResults = await withTimeout(
      Promise.allSettled([
        ragClient ? ragClient.searchRag(memoryQuery, settings) : Promise.resolve([]),
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
    );
  } catch (contextError) {
    logError("Context retrieval timed out", contextError);
    contextResults = emptyContextResults;
  }

  if (contextResults[0].status === "fulfilled") {
    rawMemory = contextResults[0].value;
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
      applyRetrievalRerank({
        query: memoryQuery,
        settings,
        ragMatches: rawMemory,
        facts: rawUserMemory.facts,
        episodes: episodicMemory.episodes,
        searchMode,
      }),
      REPLY_RERANK_TIMEOUT_MS,
      "Переранжирование",
    );
  } catch (rerankError) {
    logError("Retrieval rerank failed", rerankError);
  }
  setLiveToolStatus(null);

  const memory = reranked.rag;
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
  const liveToolsModule =
    settings.webToolsEnabled &&
    isLlmProviderOnline(settings, ollamaOnline) &&
    lastUserMessage.trim()
      ? await loadLiveTools()
      : null;
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
          proactiveTools.runLiveTool({ tool: "web_search", query }, settings),
          REPLY_PROACTIVE_WEB_SEARCH_TIMEOUT_MS,
          "Проактивный поиск",
        );
        liveToolContext = proactiveTools.formatLiveToolContext(
          { tool: "web_search", query },
          raw,
        );
      }
    } catch (toolError) {
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
        plan = await liveToolsModule.planLiveToolUse(lastUserMessage, settings);
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
        const raw = await liveToolsModule.runLiveTool(plan, settings);
        liveToolContext = liveToolsModule.formatLiveToolContext(plan, raw);
      }
    } catch (toolError) {
      logError("Live tool failed", toolError);
    } finally {
      setLiveToolStatus(null);
    }
  }

  const moodStyle = isMoodEngineEnabled(settings)
    ? moodVectorToPrompt(getCurrentMoodVector().vector)
    : null;
  const moodPrompt = moodStyle?.promptModifier ?? describeMoodForPrompt(moodForReply);
  const responseLength = chooseResponseLength(
    lastUserMessage,
    memory.length,
    Boolean(options.proactive),
    proactiveReplyTone,
    moodForReply,
    moodStyle?.responseParams,
  );
  const responseMode = classifyResponseMode({
    message: lastUserMessage,
    proactive: options.proactive,
    screenObservation: Boolean(options.screenObservation),
    eventDescription: options.eventDescription,
    initiativeKind: options.initiativeKind,
    proactiveReplyTone,
    useIntentClassifier: settings.intentClassifierEnabled,
  });
  const relationshipToneKey = deriveRelationshipTone(relationship, moodForReply);
  const relationshipTone = describeRelationshipTone(relationshipToneKey);
  const recentAssistantReplies = baseHistory
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .slice(-5);
  const userAskedQuestion =
    liveToolsModule?.isQuestionLikeMessage(lastUserMessage) ?? false;
  const validationContext = {
    hasVision: Boolean(options.screenObservation),
    hasMemory:
      userMemory.facts.length > 0 ||
      userMemory.summaries.length > 0 ||
      episodicForPrompt.episodes.length > 0 ||
      episodicForPrompt.openLoops.length > 0 ||
      Boolean(describeAriSelfMemory(selfMemory)),
    hasRag: memory.length > 0,
    hasLiveTool: Boolean(liveToolContext),
    userAskedQuestion,
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
  };
  const processReplyOptions: ProcessReplyOptions = {
    responseMode,
    validationContext,
    streamedEmotion,
    recentAssistantReplies,
    proactive: Boolean(options.proactive),
    userAskedQuestion,
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
    selfMemory: [describeAriSelfMemory(selfMemory), describeReactionLearningSummary()]
      .filter(Boolean)
      .join(". "),
    initiativeKind: options.initiativeKind,
    proactiveReplyTone,
    responseLength,
    screenObservation: options.screenObservation,
    avoidPhrases: buildAvoidPhrases(),
    emotionGuidance: describeEmotionAntiRepeat(moodForReply) ?? undefined,
    workSession: describeActiveFocusSession(getActiveFocusSession()),
    behaviorSettings: buildUserBehaviorBlock(settings, describePreferenceRules()) || undefined,
    workingMemory: describeWorkingMemory() || undefined,
    conversationMemory: describeConversationMemory() || undefined,
    moodTrigger: moodTriggerDescription,
    liveToolContext,
    projectPinnedContext: describePinnedProjectContext() || undefined,
    goalLedger: formatGoalLedgerForPrompt() || undefined,
    proactiveSignalSummary: options.proactiveSignalSummary,
    proactiveLinkNarrative: options.proactiveLinkNarrative,
    proactivePracticalHook: options.proactivePracticalHook,
    proactiveAdviceSteps: options.proactiveAdviceSteps,
    proactiveCodeExcerpt: options.proactiveCodeExcerpt,
    proactiveInitiativeMove: options.proactiveInitiativeMove,
    proactiveNoveltyGuidance: options.proactiveNoveltyGuidance,
  };
  const fittedBundle = buildTrimmedPromptContext(baseHistory, runtimeContext, settings);
  const fittedHistory = fittedBundle.fittedHistory;
  runtimeContext = fittedBundle.runtimeContext;
  if (fittedBundle.trimNotes.length) {
    fittedBundle.trimNotes.forEach((note) => recordContextTrim(note));
    ariLog("prompt-context", "debug", {
      contextTrim: fittedBundle.trimNotes.join(", "),
    });
  }

  const tokenEstimate = Math.ceil(
    (fittedHistory.reduce((total, message) => total + message.content.length, 0) +
      memory.reduce((total, fragment) => total + fragment.text.length, 0) +
      userMemory.facts.reduce((total, fact) => total + fact.text.length, 0)) /
      4,
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
