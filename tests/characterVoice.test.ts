import { describe, expect, it } from "vitest";
import { validateCharacterReply } from "../src/character/responseValidation";
import { buildCorrectionUserMessage, shouldRetryReply } from "../src/character/replyPipeline";

const emptyContext = { hasVision: false, hasMemory: false, hasRag: false };

describe("characterVoice", () => {
  it("flags masculine self-reference from Ari", () => {
    const result = validateCharacterReply("Я готов помочь с этим.", emptyContext);
    expect(result.issues).toContain("masculine self reference");
    expect(shouldRetryReply(result)).toBe(true);
  });

  it("allows feminine self-reference", () => {
    const result = validateCharacterReply("Я готова помочь с этим.", emptyContext);
    expect(result.issues).not.toContain("masculine self reference");
  });

  it("flags bland assistant openings", () => {
    const result = validateCharacterReply(
      "Конечно, вот несколько советов по задаче.",
      emptyContext,
    );
    expect(result.issues).toContain("assistant tone");
  });

  it("builds correction for masculine self reference", () => {
    const message = buildCorrectionUserMessage(["masculine self reference"]);
    expect(message).toMatch(/женском роде/i);
  });

  it("flags habitual trailing questions", () => {
    const result = validateCharacterReply(
      "Я бы начала с проверки логов и одного чистого запуска. Хочешь, я помогу?",
      emptyContext,
    );
    expect(result.issues).toContain("habitual trailing question");
    expect(shouldRetryReply(result)).toBe(true);
  });

  it("allows two caring questions in emotional support", () => {
    const result = validateCharacterReply(
      "Может, чайку горячего? Или расскажу анекдот, чтобы поднять настроение?",
      { ...emptyContext, responseMode: "emotional_support" },
    );
    expect(result.issues).not.toContain("question spam");
  });

  it("flags three questions as spam even in emotional support", () => {
    const result = validateCharacterReply(
      "Как ты? Что болит? Может, отдохнёшь?",
      { ...emptyContext, responseMode: "emotional_support" },
    );
    expect(result.issues).toContain("question spam");
  });

  it("builds correction for proactive quality issues", () => {
    const message = buildCorrectionUserMessage(["proactive quality"]);
    expect(message).toMatch(/конкретн/i);
    expect(shouldRetryReply({ valid: false, issues: ["proactive quality"] })).toBe(
      true,
    );
  });
});
