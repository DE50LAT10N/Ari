import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import { parseCommandTail } from "../src/chat/commandTailParser";
import { completeLlmJson } from "../src/llm/llmClient";

vi.mock("../src/llm/llmClient", () => ({
  completeLlmJson: vi.fn(),
}));

describe("commandTailParser", () => {
  beforeEach(() => {
    vi.mocked(completeLlmJson).mockReset();
  });

  it("returns execute false for meta discussion about regex", async () => {
    vi.mocked(completeLlmJson).mockResolvedValue({
      execute: false,
      reason: "обсуждение примера, не команда",
    });

    const result = await parseCommandTail(
      defaultSettings,
      "task-add",
      "про то как работают регексы",
      "добавь задачу про то как работают регексы",
      true,
    );

    expect(result.execute).toBe(false);
  });

  it("returns execute true with title and due for real task", async () => {
    vi.mocked(completeLlmJson).mockResolvedValue({
      execute: true,
      title: "купить молоко",
      dueText: "завтра 9:00",
    });

    const result = await parseCommandTail(
      defaultSettings,
      "task-add",
      "завтра 9:00 купить молоко",
      "добавь задачу купить молоко завтра 9:00",
      true,
    );

    expect(result.execute).toBe(true);
    expect(result.title).toBe("купить молоко");
    expect(result.dueAt).toBeTypeOf("number");
  });

  it("falls back to date regex parser when LLM offline", async () => {
    const result = await parseCommandTail(
      defaultSettings,
      "task-add",
      "завтра 9:00 купить молоко",
      "добавь задачу купить молоко завтра 9:00",
      false,
    );

    expect(result.execute).toBe(true);
    expect(result.title).toMatch(/молоко/i);
    expect(result.dueAt).toBeTypeOf("number");
    expect(completeLlmJson).not.toHaveBeenCalled();
  });
});
