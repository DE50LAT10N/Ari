import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldSendInitiative } from "../src/character/initiativeGate";
import { defaultSettings } from "../src/settings/appSettings";

vi.mock("../src/llm/llmClient", () => ({
  completeLlmJson: vi.fn(),
}));

import { completeLlmJson } from "../src/llm/llmClient";

describe("initiativeGate", () => {
  beforeEach(() => {
    vi.mocked(completeLlmJson).mockReset();
  });

  it("allows initiative when LLM gate approves", async () => {
    vi.mocked(completeLlmJson).mockResolvedValue({
      shouldSend: true,
      topic: "короткий смолток после тишины",
    });

    const decision = await shouldSendInitiative(
      [],
      "Плановая проверка инициативы после периода тишины.",
      defaultSettings,
    );

    expect(decision.shouldSend).toBe(true);
    expect(decision.topic).toContain("смолток");
  });

  it("blocks initiative when LLM gate rejects", async () => {
    vi.mocked(completeLlmJson).mockResolvedValue({
      shouldSend: false,
      topic: "",
    });

    const decision = await shouldSendInitiative(
      [],
      "Плановая проверка инициативы после периода тишины.",
      defaultSettings,
    );

    expect(decision.shouldSend).toBe(false);
  });
});
