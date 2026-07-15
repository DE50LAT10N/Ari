import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  runReplyRevisionPipeline,
  shouldSuppressProactiveReply,
} from "../src/app/replyRevisionPipeline";
import type { ProcessReplyOptions } from "../src/character/replyPipeline";

const processReplyOptions: ProcessReplyOptions = {
  responseMode: "casual",
  validationContext: {
    hasVision: false,
    hasMemory: false,
    hasRag: false,
    hasLiveTool: false,
    proactive: false,
    responseMode: "casual",
    userAskedQuestion: false,
    recentAssistantReplies: [],
  },
  proactive: false,
  userAskedQuestion: false,
  recentAssistantReplies: [],
};

describe("runReplyRevisionPipeline", () => {
  it("keeps a live corrected proactive reply despite a remaining quality warning", () => {
    expect(shouldSuppressProactiveReply(["proactive quality"])).toBe(false);
    expect(shouldSuppressProactiveReply(["assistant tone", "advice novelty"])).toBe(false);
    expect(shouldSuppressProactiveReply(["empty reply"])).toBe(true);
    expect(shouldSuppressProactiveReply(["prompt disclosure"])).toBe(true);
  });

  it("retries a reply that misses the required emotion tag", async () => {
    const runStream = vi
      .fn()
      .mockResolvedValue("<emotion>happy</emotion>\nГотово, теперь звучит нормально.");

    const result = await runReplyRevisionPipeline({
      reply: "Готово, теперь звучит нормально.",
      fittedHistory: [{ role: "user", content: "ответь коротко" }],
      runtimeContext: {},
      processReplyOptions,
      settings: defaultSettings,
      ollamaOnline: true,
      activeWindow: null,
      responseMode: "casual",
      proactive: false,
      runStream,
      clearVisibleStreamDraft: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn(),
      ariLog: vi.fn(),
    });

    expect(runStream).toHaveBeenCalledTimes(1);
    expect(result.processed.validation.valid).toBe(true);
    expect(result.processed.content).toBe("Готово, теперь звучит нормально.");
    expect(result.processed.emotion).toBe("happy");
  });
});
