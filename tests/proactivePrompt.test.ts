import { describe, expect, it } from "vitest";
import { buildMessages } from "../src/character/promptBuilder";
import { PROACTIVE_SMALLTALK_RULE } from "../src/character/proactiveLiveliness";

describe("proactive prompt", () => {
  it("anchors proactive check-ins to the selected recent topic", () => {
    const messages = buildMessages([], {
      proactive: true,
      initiativeAnchor: "что нашёл по Tauri active window permissions",
      eventDescription:
        "Плановая проверка инициативы после периода тишины.\nВозможные темы для живой реплики (выбери одну): что нашёл по Tauri active window permissions.",
    });

    const system = messages[0]?.content ?? "";
    const finalUser = messages[messages.length - 1]?.content ?? "";

    expect(system).toContain("Обязательный якорь реплики");
    expect(system).toContain("Tauri active window permissions");
    expect(system).toContain("Не задавай общий вопрос");
    expect(finalUser).toContain("Tauri active window permissions");
  });

  it("includes smalltalk rule for proactive smalltalk tone", () => {
    const messages = buildMessages([], {
      proactive: true,
      proactiveReplyTone: "smalltalk",
      initiativeKind: "check_in",
      eventDescription:
        "Плановая проверка инициативы после периода тишины.\nСвежих тем нет — дай короткую нейтральную реплику.",
    });

    const system = messages[0]?.content ?? "";
    expect(system).toContain(PROACTIVE_SMALLTALK_RULE.slice(0, 40));
    expect(system).toContain("боковую тему");
    expect(system).toContain("Не заканчивай вопросом");
    expect(system).not.toContain("Обязательный якорь реплики");
  });
});
