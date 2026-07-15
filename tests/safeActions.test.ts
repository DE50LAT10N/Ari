import { describe, expect, it } from "vitest";
import {
  extractDeterministicSafeAction,
  extractSafeAction,
} from "../src/tools/safeActions";
import { defaultSettings } from "../src/settings/appSettings";

describe("safeActions document lookup guard", () => {
  it("does not propose open_path for RAG document lookup messages", () => {
    const message =
      "Используй RAG чтобы найти в документе Вопросы ПП вопрос под номером 4";
    expect(
      extractDeterministicSafeAction(message, "", {
        activeWindow: { title: "ChatPanel.tsx - desktop-character", processName: "Cursor" },
      }),
    ).toBeNull();
  });

  it("skips LLM extraction for document lookup intent", async () => {
    const message = "Посмотри через RAG вопрос в документе Вопросы ПП номер 4";
    await expect(
      extractSafeAction(message, "По документам: 1. Пример.", defaultSettings),
    ).resolves.toBeNull();
  });

  it("still proposes open_url for explicit URL open requests", () => {
    const action = extractDeterministicSafeAction(
      "Открой https://example.com/docs",
      "",
    );
    expect(action?.type).toBe("open_url");
    expect(action?.target).toMatch(/^https:\/\/example\.com/);
  });
});
