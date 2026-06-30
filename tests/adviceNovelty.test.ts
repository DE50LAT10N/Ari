import { describe, expect, it } from "vitest";
import {
  classifyAdviceArchetype,
  evaluateAdviceNovelty,
} from "../src/character/adviceNovelty";
import type { AdviceLedgerEntry } from "../src/character/adviceLedger";

function ledgerEntry(input: Partial<AdviceLedgerEntry>): AdviceLedgerEntry {
  return {
    id: input.id ?? "entry",
    at: input.at ?? Date.now() - 10_000,
    updatedAt: input.updatedAt ?? Date.now() - 10_000,
    expiresAt: input.expiresAt ?? Date.now() + 60_000,
    topicKey: input.topicKey ?? "cursor agents",
    ...input,
  };
}

describe("adviceNovelty", () => {
  it("classifies story fallback as meta rather than valid smalltalk", () => {
    expect(
      classifyAdviceArchetype(
        "Ха, звучит как начало крутого сюжета! Надеюсь, результат будет не менее захватывающим, чем процесс...",
      ),
    ).toBe("story_meta");
  });

  it("blocks repeated timebox refocus even when wording changes", () => {
    expect(
      classifyAdviceArchetype(
        "Давай попробуем так: выбери один файл и пообещай себе следующие 10 минут ни на что не отвлекаться.",
      ),
    ).toBe("timebox_refocus");
    expect(
      classifyAdviceArchetype(
        "Предлагаю выделить 10 минут на Cursor Agents: один файл, одна проверка, один результат.",
        "refocus",
      ),
    ).toBe("timebox_refocus");
    const issues = evaluateAdviceNovelty({
      text: "Давай попробуем так: выбери один файл и пообещай себе следующие 10 минут ни на что не отвлекаться.",
      recentEntries: [
        ledgerEntry({
          adviceCandidateKind: "refocus",
          practicalHook:
            "Предлагаю выделить 10 минут на Cursor Agents: один файл, одна проверка, один результат.",
        }),
      ],
    });

    expect(issues.some((issue) => issue.kind === "repeat_archetype")).toBe(
      true,
    );
  });
});
