import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type { RerankCandidate } from "./rerank";

type LlmRerankResponse = {
  rankedIds?: unknown;
};

export async function llmRerankCandidates(
  query: string,
  candidates: RerankCandidate[],
  settings: AppSettings,
  topK: number,
): Promise<RerankCandidate[]> {
  if (!candidates.length || candidates.length <= topK) {
    return candidates.slice(0, topK);
  }

  const shortlist = candidates.slice(0, Math.min(12, candidates.length));
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "Ты ранжируешь фрагменты памяти по релевантности запросу пользователя.",
        "Верни JSON: {\"rankedIds\":[\"id1\",\"id2\",...]} — только id из списка, без новых id.",
        "Сначала самые релевантные, без дублей по смыслу.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Запрос: ${query}`,
        "",
        "Кандидаты:",
        ...shortlist.map(
          (candidate, index) =>
            `${index + 1}. [${candidate.id}] ${candidate.text.slice(0, 220)}`,
        ),
      ].join("\n"),
    },
  ];

  try {
    const response = await completeLlmJson<LlmRerankResponse>(
      messages,
      settings,
      180,
      "json",
    );
    if (!Array.isArray(response.rankedIds)) {
      return candidates.slice(0, topK);
    }
    const byId = new Map(shortlist.map((candidate) => [candidate.id, candidate]));
    const ranked: RerankCandidate[] = [];
    for (const rawId of response.rankedIds) {
      if (typeof rawId !== "string") {
        continue;
      }
      const candidate = byId.get(rawId);
      if (candidate) {
        ranked.push(candidate);
      }
      if (ranked.length >= topK) {
        break;
      }
    }
    if (!ranked.length) {
      return candidates.slice(0, topK);
    }
    const rankedIds = new Set(ranked.map((item) => item.id));
    return [
      ...ranked,
      ...candidates.filter((candidate) => !rankedIds.has(candidate.id)),
    ].slice(0, topK);
  } catch {
    return candidates.slice(0, topK);
  }
}
