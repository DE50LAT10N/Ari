import type { ExtractedMemoryFact } from "./memoryExtractor";
import { addUserMemoryFacts } from "./userMemory";
import { addToAriInbox } from "./ariInbox";
import { recordMemoryAutoCommit, recordMemoryInboxCandidate } from "./memoryTelemetry";

export const AUTO_COMMIT_CONFIDENCE_THRESHOLD = 0.85;

export function shouldAutoCommitFact(
  fact: Pick<ExtractedMemoryFact, "importance" | "confidence">,
): boolean {
  return (
    (fact.importance === "core" || fact.importance === "important") &&
    fact.confidence >= AUTO_COMMIT_CONFIDENCE_THRESHOLD
  );
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

export async function applyExtractedFacts(
  facts: ExtractedMemoryFact[],
  sourceMessage: string,
): Promise<{ autoCommitted: number; inboxed: number }> {
  let autoCommitted = 0;
  let inboxed = 0;

  for (const fact of facts) {
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
      }
      continue;
    }

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
    inboxed += 1;
  }

  return { autoCommitted, inboxed };
}
