import type { UserMemoryFact } from "./userMemory";

export type MemoryConflict = {
  newFact: string;
  conflictingFactIds: string[];
  resolution: "replace" | "merge" | "keep_both" | "ask_user";
  reason: string;
};

const UPDATE_MARKERS =
  /(теперь|больше не|перестал|начала|начал|предпочитает|просит|пиши|называется|переимен|переш[её]л|использует|сменил)/i;

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(
        /(коротк\w*|кратк\w*|длинн\w*|подробн\w*)/gu,
        "length-preference",
      )
      .replace(/(ollama|openai|gigachat|локальн\w*|облачн\w*)/gu, "provider")
      .replace(/(имя|называ\w*|переимен\w*)/gu, "name-preference")
      .replace(/[^\p{L}\p{N}-]+/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4),
  );
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.min(a.size, b.size);
}

export function resolveMemoryConflict(
  newFact: string,
  candidates: UserMemoryFact[],
): MemoryConflict {
  const similar = candidates
    .map((fact) => ({ fact, score: similarity(newFact, fact.text) }))
    .filter(({ score }) => score >= 0.48)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);

  if (!similar.length) {
    return {
      newFact,
      conflictingFactIds: [],
      resolution: "keep_both",
      reason: "Нет достаточно похожего устойчивого факта.",
    };
  }

  if (UPDATE_MARKERS.test(newFact)) {
    return {
      newFact,
      conflictingFactIds: similar.map(({ fact }) => fact.id),
      resolution: "replace",
      reason: "Новый факт сформулирован как обновление прежнего состояния.",
    };
  }

  const best = similar[0];
  if (best.score >= 0.82) {
    return {
      newFact,
      conflictingFactIds: [best.fact.id],
      resolution: "merge",
      reason: "Факт почти повторяет существующую запись.",
    };
  }

  if (best.score >= 0.55) {
    return {
      newFact,
      conflictingFactIds: similar.map(({ fact }) => fact.id),
      resolution: "ask_user",
      reason:
        "Похожие факты расходятся — лучше спросить пользователя, что оставить.",
    };
  }

  return {
    newFact,
    conflictingFactIds: similar.map(({ fact }) => fact.id),
    resolution: "keep_both",
    reason: "Факты связаны, но явное замещение не подтверждено.",
  };
}

