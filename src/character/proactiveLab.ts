import type { AppSettings } from "../settings/appSettings";

import {

  buildConversationTopics,

} from "./advisorEngine";

import {

  buildInitiativeSignalBundle,

  buildProactiveInitiativePackage,

  collectBannedProactiveTopics,

  type ProactiveInitiativePackage,

} from "./initiativeContext";

import {

  inferInitiativeMoves,

} from "./proactiveInitiativePlaybook";

import {

  buildFactLinkGraph,

  inferTopicChains,

} from "./proactiveTopicLinker";

import {

  buildGateContextFromBundle,

  collectProactiveSignalFacts,

  synthesizeProactiveBundle,

  validateProactiveReplyLlm,

  type ProactiveLlmBundle,

  type ProactiveMoveHint,

  type ProactiveReplyQualityResult,

  type ProactiveSignalFact,

  type ProactiveTopicLink,

} from "./proactiveLlmEngine";

import type { ProactiveReplyTone } from "./proactiveTone";

import { isLlmProviderOnline } from "../llm/providerOnline";



export type ProactiveLabInput = {

  tone: ProactiveReplyTone;

  recentUserMessage?: string;

  sessionMinutes?: number;

  windowTitle?: string;

  processName?: string;

  draftReply?: string;

  mockRagSnippets?: string[];

};



export type ProactiveLabPreview = {

  facts: ProactiveSignalFact[];

  moveHints: ProactiveMoveHint[];

  topicLinks: ProactiveTopicLink[];

  topicChainSummary?: string;

  llmBundle: ProactiveLlmBundle;

  package: ProactiveInitiativePackage;

  gateContext: string;

  usefulnessScore: number;

  shouldSend: boolean;

  rejectReason?: string;

};



export async function runProactiveLabPreview(

  settings: AppSettings,

  input: ProactiveLabInput,

  ollamaOnline: boolean | null = null,

): Promise<ProactiveLabPreview> {

  const bundle = buildInitiativeSignalBundle(settings, {

    sessionMinutes: input.sessionMinutes ?? 10,

    windowMinutes: input.sessionMinutes ?? 10,

    processName: input.processName ?? "Cursor.exe",

    windowTitle: input.windowTitle ?? "ChatPanel.tsx - Ari - Cursor",

  });

  const banned = collectBannedProactiveTopics();

  const candidateTopics = buildConversationTopics(bundle.advisor, 6, banned, bundle);

  const ragSnippets = input.mockRagSnippets?.filter(Boolean) ?? [];

  const llmInput = {

    bundle,

    tone: input.tone,

    bannedTopics: banned,

    candidateTopics,

    sessionMinutes: input.sessionMinutes ?? 10,

    recentUserMessage: input.recentUserMessage,

    llmOnline: isLlmProviderOnline(settings, ollamaOnline),

    ragSnippets: ragSnippets.length ? ragSnippets : undefined,

  };

  const facts = collectProactiveSignalFacts(llmInput);

  const graph = buildFactLinkGraph(facts, bundle);

  const chains = inferTopicChains(graph, facts, 2);

  const moveHints = inferInitiativeMoves(bundle, facts, ragSnippets);

  const llmBundle = await synthesizeProactiveBundle(settings, {

    ...llmInput,

    moveHints,

    topicChains: chains,

    topicLinks: graph,

  });

  const packageOptions = {

    sessionMinutes: input.sessionMinutes ?? 10,

    windowMinutes: input.sessionMinutes ?? 10,

    processName: input.processName ?? "Cursor.exe",

    windowTitle: input.windowTitle ?? "ChatPanel.tsx - Ari - Cursor",

    recentUserMessage: input.recentUserMessage,

    conversationTopics:

      llmBundle.linkedThemes.length > 0 ? llmBundle.linkedThemes : candidateTopics,

    llmBundle,

    linkSynthesis: llmBundle,

  };

  const pkg = buildProactiveInitiativePackage(settings, "check_in", packageOptions);



  return {

    facts,

    moveHints,

    topicLinks: llmBundle.topicLinks ?? graph.slice(0, 3),

    topicChainSummary: llmBundle.primaryChainSummary ?? chains[0]?.summarySeed,

    llmBundle,

    package: pkg,

    gateContext: buildGateContextFromBundle(llmBundle),

    usefulnessScore: llmBundle.usefulnessScore,

    shouldSend: llmBundle.shouldSend,

    rejectReason: llmBundle.rejectReason,

  };

}



export async function runProactiveReplyQualityCheck(

  settings: AppSettings,

  bundle: ProactiveLlmBundle,

  draftReply: string,

  facts: ProactiveSignalFact[] = [],

): Promise<ProactiveReplyQualityResult> {

  return validateProactiveReplyLlm(settings, bundle, draftReply, facts);

}

