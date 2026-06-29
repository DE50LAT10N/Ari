import { classifyUserIntent } from "../character/userIntent";
import type { AppSettings } from "../settings/appSettings";
import type { RerankCandidate } from "./rerank";

export function shouldLlmRerank(
  query: string,
  candidates: RerankCandidate[],
  settings: AppSettings,
): boolean {
  if (!settings.llmRerankEnabled || candidates.length <= 2) {
    return false;
  }

  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const top = sorted[0]?.score ?? 0;
  const third = sorted[2]?.score ?? 0;
  const tightMargin = sorted.length >= 3 && top - third < 0.05;
  const longQuery = query.trim().length > 80;
  const technical =
    settings.intentClassifierEnabled &&
    classifyUserIntent(query).intent === "technical_help";

  return longQuery || tightMargin || technical;
}
