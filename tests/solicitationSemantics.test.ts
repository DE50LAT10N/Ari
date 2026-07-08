import { describe, expect, it } from "vitest";
import {
  classifySolicitationSemantics,
  isSolicitationSentence,
} from "../src/character/solicitationSemantics";
import { validateCharacterReply } from "../src/character/responseValidation";

describe("solicitationSemantics", () => {
  it("flags meta-question invite without question mark", () => {
    const sentence =
      "Хочешь обсудить что-то конкретное из документа.";
    expect(isSolicitationSentence(sentence)).toBe(true);
    expect(classifySolicitationSemantics(sentence).reasons).toEqual(
      expect.arrayContaining(["habitual_tail"]),
    );
  });

  it("flags soft continuation verbs at the end", () => {
    const sentence = "Тебе будет полезно углубиться в тему.";
    expect(isSolicitationSentence(sentence)).toBe(true);
  });

  it("flags conditional invitations", () => {
    const sentence = "Если захочешь — могу разобрать подробнее.";
    expect(isSolicitationSentence(sentence)).toBe(true);
  });

  it("does not flag plain statements", () => {
    const sentence = "Похоже, это вопрос по документу, а не утверждение.";
    expect(isSolicitationSentence(sentence)).toBe(false);
  });

  it("validates full reply through responseValidation", () => {
    const result = validateCharacterReply(
      "Ммм... похоже на вопрос. Хочешь обсудить что-то конкретное из документа.",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        responseMode: "casual",
        recentAssistantReplies: [],
      },
    );

    expect(result.issues).toContain("habitual trailing question");
  });
});
