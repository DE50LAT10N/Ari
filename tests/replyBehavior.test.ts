import { describe, expect, it } from "vitest";
import {
  isTooSimilarToRecent,
  replySimilarity,
} from "../src/character/replySimilarity";
import { classifyResponseMode } from "../src/character/responseModes";
import {
  isQuestionLikeMessage,
  shouldAutoWebSearch,
} from "../src/tools/liveTools";

describe("replySimilarity", () => {
  it("detects near-duplicate proactive lines", () => {
    const recent =
      "А что сейчас в твоём Cursor Agents таком интригующем, что не отпускаешь курсор?";
    const duplicate =
      "А что сейчас в твоём Cursor Agents таком интригующем, что не отпускаешь курсор?";
    expect(replySimilarity(recent, duplicate)).toBe(1);
    expect(isTooSimilarToRecent(duplicate, [recent], 0.72)).toBe(true);
  });

  it("allows clearly different replies", () => {
    const recent = "Короткий перерыв не помешает.";
    const next = "Закрой лишние вкладки и вернись к задаче.";
    expect(isTooSimilarToRecent(next, [recent], 0.72)).toBe(false);
  });
});

describe("direct_answer mode", () => {
  it("classifies подскажи as direct_answer", () => {
    expect(
      classifyResponseMode({
        message: "Подскажи",
        useIntentClassifier: true,
      }),
    ).toBe("direct_answer");
  });
});

describe("proactive reply tone response mode", () => {
  it("forces technical_help for proactive advice tone", () => {
    expect(
      classifyResponseMode({
        message: "",
        proactive: true,
        initiativeKind: "check_in",
        proactiveReplyTone: "advice",
      }),
    ).toBe("technical_help");
  });

  it("uses idle_initiative for proactive smalltalk tone", () => {
    expect(
      classifyResponseMode({
        message: "",
        proactive: true,
        initiativeKind: "check_in",
        proactiveReplyTone: "smalltalk",
      }),
    ).toBe("idle_initiative");
  });
});

describe("shouldAutoWebSearch", () => {
  it("falls back to web when RAG is on but found nothing", () => {
    expect(
      shouldAutoWebSearch("Подскажи про Rust async", {
        ragEnabled: true,
        ragMatchCount: 0,
      }),
    ).toBe(true);
    expect(isQuestionLikeMessage("Подскажи")).toBe(true);
  });

  it("skips web when RAG already has matches", () => {
    expect(
      shouldAutoWebSearch("Что такое Tauri?", {
        ragEnabled: true,
        ragMatchCount: 2,
      }),
    ).toBe(false);
  });

  it("allows web for questions when RAG is disabled", () => {
    expect(
      shouldAutoWebSearch("Подскажи про Rust", {
        ragEnabled: false,
        ragMatchCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldAutoWebSearch("найди в интернете курс доллара", {
        ragEnabled: false,
        ragMatchCount: 0,
      }),
    ).toBe(true);
  });
});
