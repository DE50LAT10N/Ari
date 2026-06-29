import { describe, expect, it } from "vitest";
import { buildMessages } from "../src/character/promptBuilder";

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
});
