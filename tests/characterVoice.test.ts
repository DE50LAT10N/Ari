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

  it("allows a transparent AI-character identity", () => {
    const result = validateCharacterReply(
      "Я AI-персонаж Ari, не человек — но разбирать код могу вполне честно.",
      emptyContext,
    );
    expect(result.issues).not.toContain("identity leak");
  });

  it("blocks disclosure of the hidden provider or base model", () => {
    const result = validateCharacterReply(
      "На самом деле меня запустили на модели GPT-4.",
      emptyContext,
    );
    expect(result.issues).toContain("identity leak");
  });

  it("allows useful numbered steps in technical responses", () => {
    const result = validateCharacterReply(
      "1. Шаг: воспроизведи ошибку.\n2. Проверка: сравни stack trace.",
      { ...emptyContext, responseMode: "technical_help" },
    );
    expect(result.issues).not.toContain("assistant tone");
  });

  it("requires explicit memory claims to overlap injected evidence", () => {
    const grounded = validateCharacterReply("Я помню, ты выбирал Rust.", {
      ...emptyContext,
      hasMemory: true,
      memoryEvidence: ["Пользователь предпочитает Rust для native-модулей"],
    });
    const ungrounded = validateCharacterReply("Я помню, ты выбирал Go.", {
      ...emptyContext,
      hasMemory: true,
      memoryEvidence: ["Пользователь предпочитает Rust для native-модулей"],
    });
    expect(grounded.issues).not.toContain(
      "memory claim without injected memory",
    );
    expect(ungrounded.issues).toContain("memory claim without injected memory");
  });

  it("requires document claims to overlap retrieved evidence", () => {
    const grounded = validateCharacterReply(
      "По документам, таймаут обрабатывает AbortController.",
      {
        ...emptyContext,
        hasRag: true,
        ragEvidence: ["Таймаут должен отменять запрос через AbortController"],
      },
    );
    const ungrounded = validateCharacterReply(
      "По документам, авторизация сделана через OAuth.",
      {
        ...emptyContext,
        hasRag: true,
        ragEvidence: ["Таймаут должен отменять запрос через AbortController"],
      },
    );
    expect(grounded.issues).not.toContain("RAG claim without fragments");
    expect(ungrounded.issues).toContain("RAG claim without fragments");
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
