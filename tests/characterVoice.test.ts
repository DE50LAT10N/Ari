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

  it("allows necessary single clarification questions", () => {
    const result = validateCharacterReply(
      "Уточни, пожалуйста: речь про dev-сборку или установленный билд?",
      emptyContext,
    );
    expect(result.issues).not.toContain("habitual trailing question");
    expect(result.issues).not.toContain("question spam");
  });
});
