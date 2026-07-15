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

    const prompt = messages.map((message) => message.content).join("\n");
    const system = messages[0]?.content ?? "";
    const finalUser = messages[messages.length - 1]?.content ?? "";

    expect(prompt).toContain("Обязательный якорь реплики");
    expect(prompt).toContain("Tauri active window permissions");
    expect(prompt).toContain("Не задавай общий вопрос");
    expect(system).not.toContain("Tauri active window permissions");
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

    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toContain(PROACTIVE_SMALLTALK_RULE.slice(0, 40));
    expect(prompt).toContain("боковую тему");
    expect(prompt).toContain("Не заканчивай вопросом");
    expect(prompt).not.toContain("Обязательный якорь реплики");
  });

  it("includes code excerpt guidance for proactive advice when available", () => {
    const messages = buildMessages([], {
      proactive: true,
      proactiveReplyTone: "advice",
      initiativeKind: "process_advice",
      proactiveCodeExcerpt: {
        file: "ChatPanel.tsx",
        text: "export const x = 1;",
      },
      eventDescription: "Совет по коду",
    });

    const prompt = messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("Если передан реальный код из файла");
    expect(prompt).toContain("Код из файла ChatPanel.tsx");
    expect(prompt).toContain("export const x = 1");
  });
});
