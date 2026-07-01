import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type { OpenLoop } from "./episodicMemory";
import type { ExtractedMemoryFact } from "./memoryExtractor";

type ConversationPostprocessResponse = {
  facts?: unknown;
  episode?: unknown;
  openLoops?: unknown;
  resolvedLoopIds?: unknown;
};

export type ConversationPostprocessResult = {
  facts: ExtractedMemoryFact[];
  episode: { title: string; text: string } | null;
  openLoops: Array<{ text: string; dueAt?: number; confidence?: number }>;
  resolvedLoopIds: string[];
};

function parseFacts(value: unknown): ExtractedMemoryFact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry): ExtractedMemoryFact[] => {
      if (typeof entry === "string") {
        return [
          { text: entry.trim(), importance: "useful", confidence: 0.65 },
        ];
      }
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const fact = entry as Record<string, unknown>;
      if (typeof fact.text !== "string") {
        return [];
      }
      const importance =
        fact.importance === "trivial" ||
        fact.importance === "useful" ||
        fact.importance === "important" ||
        fact.importance === "core"
          ? fact.importance
          : "useful";
      if (importance === "trivial") {
        return [];
      }
      return [
        {
          text: fact.text.trim(),
          importance,
          confidence:
            typeof fact.confidence === "number"
              ? Math.max(0.1, Math.min(1, fact.confidence))
              : 0.7,
        },
      ];
    })
    .filter(({ text }) => Boolean(text))
    .slice(0, 5);
}

function parseEpisode(
  value: unknown,
): ConversationPostprocessResult["episode"] {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { title?: unknown }).title !== "string" ||
    typeof (value as { text?: unknown }).text !== "string"
  ) {
    return null;
  }

  const episode = {
    title: (value as { title: string }).title.trim(),
    text: (value as { text: string }).text.trim(),
  };
  return episode.text ? episode : null;
}

function parseOpenLoops(
  value: unknown,
): ConversationPostprocessResult["openLoops"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ text: entry }];
    }
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { text?: unknown }).text !== "string"
    ) {
      return [];
    }

    const rawDueAt = (entry as { dueAt?: unknown }).dueAt;
    const parsedDueAt =
      typeof rawDueAt === "string"
        ? Date.parse(rawDueAt)
        : typeof rawDueAt === "number"
          ? rawDueAt
          : NaN;
    const rawConfidence = (entry as { confidence?: unknown }).confidence;
    const confidence =
      typeof rawConfidence === "number"
        ? Math.max(0.1, Math.min(1, rawConfidence))
        : undefined;

    return [
      {
        text: (entry as { text: string }).text.trim(),
        dueAt: Number.isFinite(parsedDueAt) ? parsedDueAt : undefined,
        confidence,
      },
    ];
  }).filter(({ text }) => Boolean(text));
}

function parseResolvedLoopIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export async function postprocessConversationMemory(
  userMessage: string,
  assistantReply: string,
  existingLoops: OpenLoop[],
  settings: AppSettings,
): Promise<ConversationPostprocessResult> {
  const response = await completeLlmJson<ConversationPostprocessResponse>(
    [
      {
        role: "system",
        content: [
          "Extract durable user memory and episodic conversation updates in one pass.",
          "facts: stable facts about the user such as preferences, habits, work style, long-term goals, projects, constraints, or explicit remember requests.",
          "Do not save passwords, keys, addresses, payment data, medical data, or one-off tasks without reusable meaning.",
          "importance must be trivial, useful, important, or core. Return trivial only when it should be discarded.",
          "episode: save only if a concrete shared event happened: solved a problem, made a decision, started or finished meaningful work.",
          "openLoops: promises, plans, questions, reminders, or checks that are reasonable to revisit later.",
          "dueAt must be an ISO 8601 local datetime only when the user gave a time or asked for a reminder. Do not invent due dates.",
          "resolvedLoopIds: existing loop ids only when the user explicitly reported a result or cancelled the loop.",
          'Return strict JSON: {"facts":[{"text":"","importance":"useful","confidence":0.8}],"episode":{"title":"","text":""}|null,"openLoops":[{"text":"","dueAt":null,"confidence":0.7}],"resolvedLoopIds":["id"]}.',
          "If nothing should be saved, return empty arrays and null episode.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `User message:\n${userMessage}`,
          `Ari reply:\n${assistantReply}`,
          `Local date/time:\n${new Date().toString()}`,
          "Existing open loops:",
          existingLoops.length
            ? existingLoops.map(({ id, text }) => `${id}: ${text}`).join("\n")
            : "none",
        ].join("\n\n"),
      },
    ] satisfies ChatMessage[],
    settings,
    650,
    "memoryExtraction",
  );

  return {
    facts: parseFacts(response.facts),
    episode: parseEpisode(response.episode),
    openLoops: parseOpenLoops(response.openLoops),
    resolvedLoopIds: parseResolvedLoopIds(response.resolvedLoopIds),
  };
}
