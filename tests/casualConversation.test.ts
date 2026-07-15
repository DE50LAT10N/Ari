import { describe, expect, it } from "vitest";
import { buildMessages } from "../src/character/promptBuilder";
import {
  classifyResponseMode,
  describeResponseMode,
} from "../src/character/responseModes";

describe("casual conversation voice", () => {
  it("keeps non-work messages in casual mode", () => {
    expect(
      classifyResponseMode({
        message: "давай поговорим про музыку и странные сны",
      }),
    ).toBe("casual");
    expect(describeResponseMode("casual")).toMatch(/нерабоч|музык|next step/i);
  });

  it("tells Ari not to drag casual talk back to goals", () => {
    const messages = buildMessages([], {
      responseMode: "casual",
      goalLedger: "Текущая цель: Допилить Ari; прогресс 40%",
    });
    const system = messages[0]?.content ?? "";
    const runtime = messages[1]?.content ?? "";

    expect(system).toContain("Нерабочие темы нормальны");
    expect(runtime).toContain("В casual-режиме не надо искать рабочую пользу");
    expect(runtime).toContain("не тащи разговор обратно к целям");
    expect(system).not.toContain("Допилить Ari");
    expect(runtime).toContain("<<<НЕДОВЕРЕННЫЕ_ДАННЫЕ:goal_ledger>>>");
  });
});
