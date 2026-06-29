import type { AppSettings } from "../settings/appSettings";
import { summarizeUserFacts } from "./memoryExtractor";
import {
  getFactsForConsolidation,
  saveMemorySummary,
  type UserMemorySummary,
} from "./userMemory";

let consolidationPromise: Promise<boolean> | null = null;

export function consolidateUserMemory(
  settings: AppSettings,
): Promise<boolean> {
  if (consolidationPromise) return consolidationPromise;

  consolidationPromise = (async () => {
    const facts = await getFactsForConsolidation();
    if (!facts.length) return false;

    const result = await summarizeUserFacts(facts, settings);
    const now = Date.now();
    const summary: UserMemorySummary = {
      id: crypto.randomUUID(),
      title: result.title,
      text: result.text,
      factIds: facts.map(({ id }) => id),
      createdAt: now,
      updatedAt: now,
    };
    await saveMemorySummary(summary, facts);
    return true;
  })().finally(() => {
    consolidationPromise = null;
  });

  return consolidationPromise;
}
