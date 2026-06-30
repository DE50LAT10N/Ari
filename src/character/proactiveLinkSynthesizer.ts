export {
  collectProactiveSignalFacts,
  synthesizeProactiveLinks,
  synthesizeProactiveBundle,
  validateProactiveReplyLlm,
  buildGateContextFromSynthesis,
  buildGateContextFromBundle,
  buildProactiveSummaryFromSynthesis,
  buildProactiveSummaryFromBundle,
  getLastProactiveLlmBundle,
  getLastProactiveSignalFacts,
  setLastProactiveLlmBundle,
  resetProactiveLlmCacheForTests,
  shouldRunLinkSynthesis,
  llmBundleToLinkSynthesis,
  type ProactiveSignalFact,
  type ProactiveSignalFactKind,
  type ProactiveLinkSynthesis,
  type ProactiveLlmBundle,
  type ProactiveLlmInput,
  type ProactiveReplyQualityResult,
  type ProactiveInitiativeMove,
  type ProactiveMoveHint,
  type ProactiveTopicLink,
  type ProactiveTopicChain,
} from "./proactiveLlmEngine";

import { resetProactiveLlmCacheForTests } from "./proactiveLlmEngine";

/** @deprecated */
export function resetProactiveLinkCacheForTests(): void {
  resetProactiveLlmCacheForTests();
}

export type { ProactiveLlmInput as ProactiveLinkInput } from "./proactiveLlmEngine";
