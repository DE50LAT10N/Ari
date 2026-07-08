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
import { validateCharacterReply } from "../src/character/responseValidation";
import {
  softenTrailingQuestion,
  trySoftenTrailingQuestionReply,
} from "../src/character/replyPipeline";

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

  it("flags trailing questions in proactive smalltalk", () => {
    const result = validateCharacterReply(
      "В мире технологий сегодня явно пахнет маленькой странностью, заметил?",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        proactive: true,
        proactiveReplyTone: "smalltalk",
        recentAssistantReplies: [],
      },
    );

    expect(result.issues).toContain("habitual trailing question");
  });

  it("flags casual trailing questions like ладно?", () => {
    const result = validateCharacterReply("Береги себя, ладно?", {
      hasVision: false,
      hasMemory: false,
      hasRag: false,
      responseMode: "casual",
      recentAssistantReplies: [],
    });

    expect(result.issues).toContain("habitual trailing question");
  });

  it("flags a single casual trailing question without recent streak", () => {
    const result = validateCharacterReply(
      "Может, заварим чай и обсудим планы на вечер?",
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

  it("flags proactive advice with trailing question for concrete_step", () => {
    const result = validateCharacterReply(
      "А какой раздел учебной программы тебе сейчас интереснее всего изучать? Могу предложить пару трюков?",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        proactive: true,
        proactiveReplyTone: "advice",
        proactiveInitiativeMove: "concrete_step",
        responseMode: "technical_help",
        recentAssistantReplies: [],
      },
    );

    expect(result.issues).toContain("habitual trailing question");
  });

  it("allows clarifying proactive advice to end with a question", () => {
    const result = validateCharacterReply(
      "Сейчас фокус на readme — дописываешь запись к релизу или правишь уже существующий блок?",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        proactive: true,
        proactiveReplyTone: "advice",
        proactiveInitiativeMove: "ask_clarifying",
        responseMode: "technical_help",
        recentAssistantReplies: [],
      },
    );

    expect(result.issues).not.toContain("habitual trailing question");
  });

  it("allows emotional support choice offers with или", () => {
    const result = validateCharacterReply(
      "Может, чайку горячего? Или расскажу анекдот, чтобы поднять настроение?",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        responseMode: "emotional_support",
        recentAssistantReplies: [],
      },
    );

    expect(result.issues).not.toContain("habitual trailing question");
  });

  it("flags repeated trailing questions across recent replies", () => {
    const result = validateCharacterReply("This answer is tidy enough?", {
      hasVision: false,
      hasMemory: false,
      hasRag: false,
      proactive: false,
      recentAssistantReplies: [
        "First short aside?",
        "Second short aside?",
        "A completed statement.",
      ],
    });

    expect(result.issues).toContain("habitual trailing question");
  });

  it("does not flag a trailing question after a direct user question", () => {
    const result = validateCharacterReply("This path is plausible; want the shorter fix?", {
      hasVision: false,
      hasMemory: false,
      hasRag: false,
      proactive: false,
      userAskedQuestion: true,
      recentAssistantReplies: [
        "First short aside?",
        "Second short aside?",
        "A completed statement.",
      ],
    });

    expect(result.issues).not.toContain("habitual trailing question");
  });

  it("does not flag proactive advice novelty via post-hoc regex validation", () => {
    const result = validateCharacterReply(
      "Давай попробуем так: выбери один файл и пообещай себе следующие 10 минут ни на что не отвлекаться.",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        proactive: true,
        proactiveReplyTone: "advice",
        recentAssistantReplies: [
          "Предлагаю выделить 10 минут на Cursor Agents: один файл, одна проверка, один результат.",
        ],
      },
    );

    expect(result.issues).not.toContain("advice novelty");
    expect(result.issues).not.toContain("shallow advice");
  });

  it("flags solicitation phrasing without a question mark", () => {
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

  it("flags proactive story fallback locally", () => {
    const result = validateCharacterReply(
      "Ха, звучит как начало крутого сюжета! Надеюсь, результат будет не менее захватывающим, чем процесс...",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        proactive: true,
        proactiveReplyTone: "smalltalk",
        recentAssistantReplies: [],
      },
    );

    expect(result.issues).not.toContain("proactive meta commentary");
  });
});

describe("softenTrailingQuestion", () => {
  it("drops a trailing solicitation sentence", () => {
    expect(
      softenTrailingQuestion(
        "Ммм... похоже на вопрос. Хочешь обсудить что-то конкретное из документа.",
      ),
    ).toBe("Ммм... похоже на вопрос.");
  });

  it("keeps the original when only one solicitation sentence remains", () => {
    expect(softenTrailingQuestion("Береги себя, ладно?")).toBe(
      "Береги себя, ладно?",
    );
  });

  it("passes validation after dropping trailing solicitation", () => {
    const processed = trySoftenTrailingQuestionReply(
      {
        content:
          "Ммм... похоже на вопрос. Хочешь обсудить что-то конкретное из документа.",
        emotion: "curious",
        validation: {
          valid: false,
          issues: ["habitual trailing question"],
        },
      },
      {
        validationContext: {
          hasVision: false,
          hasMemory: false,
          hasRag: false,
          responseMode: "casual",
        },
      },
    );

    expect(processed.content).toBe("Ммм... похоже на вопрос.");
    expect(processed.validation.valid).toBe(true);
    expect(processed.validation.issues).not.toContain(
      "habitual trailing question",
    );
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
