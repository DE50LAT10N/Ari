import type { ExtractedMemoryFact } from "./memoryExtractor";
import { addUserMemoryFacts } from "./userMemory";
import { addToAriInbox } from "./ariInbox";
import { recordMemoryAutoCommit, recordMemoryInboxCandidate } from "./memoryTelemetry";
import { logError } from "../platform/logger";

export const AUTO_COMMIT_CONFIDENCE_THRESHOLD = 0.78;

export function shouldAutoCommitFact(
  fact: Pick<ExtractedMemoryFact, "importance" | "confidence">,
): boolean {
  if (fact.importance === "core") {
    return fact.confidence >= 0.72;
  }
  if (fact.importance === "important") {
    return fact.confidence >= AUTO_COMMIT_CONFIDENCE_THRESHOLD;
  }
  if (fact.importance === "useful") {
    return fact.confidence >= 0.82;
  }
  return false;
}

export type ExtractedOpenLoop = {
  text: string;
  dueAt?: number;
  confidence?: number;
};

export function shouldAutoCommitOpenLoop(loop: ExtractedOpenLoop): boolean {
  if (loop.dueAt) {
    return false;
  }
  const confidence = loop.confidence ?? 0.7;
  return (
    confidence >= AUTO_COMMIT_CONFIDENCE_THRESHOLD &&
    loop.text.trim().length >= 12
  );
}

function inboxExtractedFact(
  fact: ExtractedMemoryFact,
  sourceMessage: string,
): void {
  addToAriInbox({
    kind: "memory",
    title: fact.text.slice(0, 120),
    body: fact.text,
    sourceMessage,
    confidence: fact.confidence,
    reason: "Автоизвлечение из диалога",
    metadata: {
      importance:
        fact.importance === "core" || fact.importance === "important"
          ? fact.importance
          : "useful",
    },
  });
  recordMemoryInboxCandidate(fact.text);
}

export async function applyExtractedFacts(
  facts: ExtractedMemoryFact[],
  sourceMessage: string,
): Promise<{ autoCommitted: number; inboxed: number }> {
  let autoCommitted = 0;
  let inboxed = 0;

  for (const fact of facts) {
    try {
      if (shouldAutoCommitFact(fact)) {
        const result = await addUserMemoryFacts(
          [
            {
              text: fact.text,
              importance: fact.importance,
              confidence: fact.confidence,
            },
          ],
          "automatic",
        );
        if (result.added.length > 0) {
          recordMemoryAutoCommit(fact.text, fact.importance, fact.confidence);
          autoCommitted += 1;
        } else if (result.updated.length > 0) {
          autoCommitted += 1;
        } else {
          inboxExtractedFact(fact, sourceMessage);
          inboxed += 1;
        }
        continue;
      }

      inboxExtractedFact(fact, sourceMessage);
      inboxed += 1;
    } catch (error) {
      logError("Memory fact save failed, routing to inbox", error);
      try {
        inboxExtractedFact(fact, sourceMessage);
        inboxed += 1;
      } catch (inboxError) {
        logError("Memory inbox fallback failed", inboxError);
      }
    }
  }

  return { autoCommitted, inboxed };
}
