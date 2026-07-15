export const REPLY_CONTEXT_RETRIEVAL_TIMEOUT_MS = 40_000;
export const REPLY_RERANK_TIMEOUT_MS = 15_000;
export const REPLY_PROACTIVE_WEB_SEARCH_TIMEOUT_MS = 30_000;
export const REPLY_STREAM_TIMEOUT_MS = 180_000;
export const REPLY_STREAM_UI_THROTTLE_MS = 100;
export const REPLY_AMBIENT_BUBBLE_MAX_CHARS = 220;

/** Dynamic external/persisted evidence must be validated before any draft is shown. */
export function requiresValidatedReveal(context: RuntimeContext): boolean {
  return Boolean(
    context.memory?.length ||
      context.userFacts?.length ||
      context.memorySummaries?.length ||
      context.episodes?.length ||
      context.liveToolContext ||
      context.screenObservation ||
      context.projectPinnedContext ||
      context.workingMemory ||
      context.conversationMemory ||
      context.ideMentorEvidence,
  );
}
import type { RuntimeContext } from "../character/promptBuilder";
