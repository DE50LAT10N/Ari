import type { AdviceLedgerEntry } from "./adviceLedger";
import type { AdviceCandidate, AdviceCandidateKind } from "./advicePlanner";

export type AdviceArchetype =
  | "timebox_refocus"
  | "one_file_focus"
  | "story_meta"
  | "generic_encouragement"
  | "rest"
  | "debug_step"
  | "task_bridge"
  | "scope_cut"
  | "docs_lookup"
  | "clarifying_probe"
  | "unknown";

export type AdviceNoveltyIssue = {
  kind: "repeat_archetype" | "repeat_text" | "fallback_meta";
  archetype: AdviceArchetype;
  reason: string;
};

const RECENT_ADVICE_WINDOW_MS = 6 * 60 * 60_000;
const HIGH_RISK_ARCHETYPES: AdviceArchetype[] = [
  "timebox_refocus",
  "one_file_focus",
  "story_meta",
  "generic_encouragement",
];

export function normalizeAdviceText(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/<emotion>[^<]+<\/emotion>/gi, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyAdviceArchetype(
  text?: string,
  candidateKind?: AdviceCandidateKind | string,
): AdviceArchetype {
  const normalized = normalizeAdviceText(text);
  if (
    /сюжет|сценар|процесс|захватывающ|крутого\s+сюжета/.test(normalized)
  ) {
    return "story_meta";
  }
  const mentionsShortTimebox =
    /(?:10|15|десять|пятнадцать)/.test(normalized) &&
    /минут|мин\b/.test(normalized);
  const mentionsOneThingFocus =
    /один\s+файл|одну\s+задач|одна\s+проверк|не\s+отвлека|погрузись/.test(
      normalized,
    );
  if (mentionsShortTimebox && mentionsOneThingFocus) {
    return "timebox_refocus";
  }
  if (
    /один\s+файл|одну\s+задач|одна\s+проверк/.test(normalized) &&
    /работай|проверь|выбери|сфокусируйся|погрузись/.test(normalized)
  ) {
    return "one_file_focus";
  }
  if (
    /ты\s+справишься|так\s+проще|поможет\s+быстрее|увидеть\s+прогресс|будет\s+не\s+менее/.test(
      normalized,
    ) &&
    !/npm|pnpm|cargo|git|tsc|файл|строк|ошиб|stack|trace/i.test(text ?? "")
  ) {
    return "generic_encouragement";
  }
  if (/перерыв|отдох|пауза|выдохни/.test(normalized)) {
    return "rest";
  }
  if (/stack|trace|ошиб|exception|error|debug|отлад|импорт|лог/.test(normalized)) {
    return "debug_step";
  }
  if (/задач|цель|следующий\s+шаг/.test(normalized)) {
    return candidateKind === "scope_cut" ? "scope_cut" : "task_bridge";
  }
  if (/документ|материал|поиск|фрагмент|rag/.test(normalized)) {
    return "docs_lookup";
  }
  if (/спроси|уточни|где\s+именно|что\s+именно/.test(normalized)) {
    return "clarifying_probe";
  }

  switch (candidateKind) {
    case "refocus":
      return "one_file_focus";
    case "scope_cut":
      return "scope_cut";
    case "rest":
      return "rest";
    case "debug_next_step":
      return "debug_step";
    case "task_bridge":
      return "task_bridge";
    case "docs_lookup":
      return "docs_lookup";
    case "clarifying_probe":
      return "clarifying_probe";
    default:
      return "unknown";
  }
}

export function adviceTokenOverlap(left?: string, right?: string): number {
  const leftWords = new Set(
    normalizeAdviceText(left)
      .split(/\s+/)
      .filter((word) => word.length > 4),
  );
  const rightWords = normalizeAdviceText(right)
    .split(/\s+/)
    .filter((word) => word.length > 4);
  if (!leftWords.size || !rightWords.length) {
    return 0;
  }
  const hits = rightWords.filter((word) => leftWords.has(word)).length;
  return hits / Math.max(leftWords.size, rightWords.length);
}

export function adviceEntryText(entry: AdviceLedgerEntry): string {
  return [entry.practicalHook, entry.replyText, entry.linkNarrative]
    .filter(Boolean)
    .join(" ");
}

export function recentAdviceEntries(
  entries: AdviceLedgerEntry[],
  now = Date.now(),
): AdviceLedgerEntry[] {
  return entries
    .filter((entry) => now - entry.at <= RECENT_ADVICE_WINDOW_MS)
    .sort((left, right) => right.at - left.at);
}

export function evaluateAdviceNovelty(input: {
  text: string;
  candidateKind?: AdviceCandidateKind | string;
  recentEntries?: AdviceLedgerEntry[];
  recentReplies?: string[];
  now?: number;
}): AdviceNoveltyIssue[] {
  const issues: AdviceNoveltyIssue[] = [];
  const now = input.now ?? Date.now();
  const archetype = classifyAdviceArchetype(input.text, input.candidateKind);
  if (archetype === "story_meta") {
    issues.push({
      kind: "fallback_meta",
      archetype,
      reason: "мета-комментарий про сюжет/процесс вместо текущего факта",
    });
  }

  const recentEntries = recentAdviceEntries(input.recentEntries ?? [], now);
  let archetypeMatches = 0;
  let textMatches = 0;

  for (const entry of recentEntries.slice(0, 12)) {
    const entryText = adviceEntryText(entry);
    const entryArchetype = classifyAdviceArchetype(
      entryText,
      entry.adviceCandidateKind ?? entry.initiativeMove,
    );
    if (archetype !== "unknown" && entryArchetype === archetype) {
      archetypeMatches += 1;
    }
    if (
      Math.max(
        adviceTokenOverlap(input.text, entry.practicalHook),
        adviceTokenOverlap(input.text, entry.replyText),
      ) >= 0.32
    ) {
      textMatches += 1;
    }
  }

  for (const reply of input.recentReplies ?? []) {
    const replyArchetype = classifyAdviceArchetype(reply);
    if (archetype !== "unknown" && replyArchetype === archetype) {
      archetypeMatches += 1;
    }
    if (adviceTokenOverlap(input.text, reply) >= 0.32) {
      textMatches += 1;
    }
  }

  if (
    archetype !== "unknown" &&
    (HIGH_RISK_ARCHETYPES.includes(archetype)
      ? archetypeMatches >= 1
      : archetypeMatches >= 2)
  ) {
    issues.push({
      kind: "repeat_archetype",
      archetype,
      reason: `повторяется архетип совета: ${archetype}`,
    });
  }
  if (textMatches >= 1) {
    issues.push({
      kind: "repeat_text",
      archetype,
      reason: "слишком похожая формулировка или hook",
    });
  }

  return issues;
}

export function evaluateAdviceCandidateNovelty(input: {
  candidate: AdviceCandidate;
  recentEntries: AdviceLedgerEntry[];
  now?: number;
}): AdviceNoveltyIssue[] {
  return evaluateAdviceNovelty({
    text: input.candidate.actionText,
    candidateKind: input.candidate.kind,
    recentEntries: input.recentEntries,
    now: input.now,
  });
}

export function describeAdviceNoveltyForPrompt(
  entries: AdviceLedgerEntry[],
  now = Date.now(),
): string {
  const recent = recentAdviceEntries(entries, now)
    .filter((entry) => entry.practicalHook || entry.replyText)
    .slice(0, 6);
  if (!recent.length) {
    return "";
  }
  const lines = recent.map((entry) => {
    const text = adviceEntryText(entry).replace(/\s+/g, " ").slice(0, 150);
    const archetype = classifyAdviceArchetype(
      text,
      entry.adviceCandidateKind ?? entry.initiativeMove,
    );
    return `- ${archetype}: ${text}`;
  });
  return [
    "Недавние архетипы советов, которые нельзя повторять:",
    ...lines,
    "Если следующий совет похож по архетипу или структуре, лучше не писать совет вовсе.",
  ].join("\n");
}
