import { describe, expect, it } from "vitest";
import { adviceTextSimilarity } from "../src/character/adviceNovelty";

describe("advice text similarity", () => {
  it("detects close paraphrases via trigram similarity", () => {
    const score = adviceTextSimilarity(
      "Проверь импорт в ChatPanel.tsx и затем запусти build",
      "Проверь импорты в ChatPanel.tsx, потом запусти сборку",
    );

    expect(score).toBeGreaterThan(0.32);
  });

  it("does not collapse unrelated advice", () => {
    const score = adviceTextSimilarity(
      "Проверь импорт в ChatPanel.tsx",
      "Сделай перерыв и вернись к задаче через десять минут",
    );

    expect(score).toBeLessThan(0.32);
  });
});
