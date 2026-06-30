import { describe, expect, it } from "vitest";
import {
  findGigaChatChatModel,
  isLiteGigaChatModelId,
  migrateGigaChatModelSettings,
  resolveGigaChatAuxModel,
  syncGigaChatModelSelection,
} from "../src/llm/gigaChatModels";
import { resolveModel } from "../src/llm/modelRouter";
import { defaultSettings } from "../src/settings/appSettings";

describe("gigaChatModels", () => {
  it("classifies lite tiers", () => {
    expect(isLiteGigaChatModelId("GigaChat-2")).toBe(true);
    expect(isLiteGigaChatModelId("GigaChat")).toBe(true);
    expect(isLiteGigaChatModelId("GigaChat-2-Pro")).toBe(false);
    expect(isLiteGigaChatModelId("GigaChat-2-Max")).toBe(false);
  });

  it("exposes catalog entries", () => {
    expect(findGigaChatChatModel("GigaChat-2-Max")?.tier).toBe("max");
    expect(findGigaChatChatModel("GigaChat-2-Pro")?.tier).toBe("pro");
  });

  it("upgrades lite auxiliary to chat tier when chat is pro", () => {
    expect(
      resolveGigaChatAuxModel("GigaChat-2-Pro", "GigaChat"),
    ).toBe("GigaChat-2-Pro");
    expect(
      resolveGigaChatAuxModel("GigaChat-2-Pro", "GigaChat-2"),
    ).toBe("GigaChat-2-Pro");
    expect(
      resolveGigaChatAuxModel("GigaChat-2-Pro", undefined),
    ).toBe("GigaChat-2-Pro");
    expect(
      resolveGigaChatAuxModel("GigaChat-2", "GigaChat-2-Pro"),
    ).toBe("GigaChat-2-Pro");
  });

  it("syncs stored settings when switching chat to pro", () => {
    const synced = syncGigaChatModelSelection(
      {
        ...defaultSettings,
        llmProvider: "gigachat",
        gigaChatModel: "GigaChat",
        gigaChatVisionModel: "GigaChat",
        fastJsonModel: "GigaChat-2",
      },
      "GigaChat-2-Pro",
    );
    expect(synced.gigaChatModel).toBe("GigaChat-2-Pro");
    expect(synced.fastJsonModel).toBeUndefined();
    expect(synced.gigaChatVisionModel).toBe("GigaChat-2-Pro");
  });

  it("migrates lite aux models on load when chat is pro", () => {
    const migrated = migrateGigaChatModelSettings({
      ...defaultSettings,
      llmProvider: "gigachat",
      gigaChatModel: "GigaChat-Pro",
      gigaChatVisionModel: "GigaChat",
      fastJsonModel: "GigaChat-2",
    });
    expect(migrated.fastJsonModel).toBeUndefined();
    expect(migrated.gigaChatVisionModel).toBe("GigaChat-Pro");
  });

  it("routes json tasks through aux resolver in modelRouter", () => {
    const settings = {
      ...defaultSettings,
      llmProvider: "gigachat" as const,
      gigaChatModel: "GigaChat-2-Pro",
      fastJsonModel: "GigaChat-2",
    };
    expect(resolveModel("json", settings)).toBe("GigaChat-2-Pro");
    expect(resolveModel("initiativeSynthesis", settings)).toBe("GigaChat-2-Pro");
  });
});
