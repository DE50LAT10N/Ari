import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAdvisorAngleIntent,
  buildConversationTopics,
  hasActionableAdvisorSignals,
  pickPlannedInitiativeAnchor,
  selectAdvisorAngle,
  topicOverlapsRecent,
} from "../src/character/advisorEngine";
import { buildInitiativeSignalBundle } from "../src/character/initiativeContext";
import { buildAdvisorContext } from "../src/character/advisorContext";
import { defaultSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordQueryTopic,
} from "../src/memory/activitySignals";
import {
  invalidateProactiveStateCache,
  rememberProactiveTopic,
} from "../src/character/proactiveState";

function setupStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("advisorEngine", () => {
  beforeEach(() => {
    setupStorage();
    invalidateActivitySignalsCache();
    invalidateProactiveStateCache();
  });

  it("selects rest angle when break is due", () => {
    const ctx = buildAdvisorContext(defaultSettings, {
      sessionMinutes: 60,
      windowMinutes: 60,
    });
    expect(selectAdvisorAngle(ctx)).toBe("rest");
  });

  it("builds non-empty initiative prompts per angle", () => {
    const restCtx = buildAdvisorContext(defaultSettings, {
      sessionMinutes: 60,
      windowMinutes: 60,
    });
    const restPrompt = buildAdvisorAngleIntent(restCtx, "rest");
    expect(restPrompt).toContain("перерыв");
    expect(restPrompt).not.toMatch(/вижу экран/i);

    recordQueryTopic({ topic: "react hooks", source: "browser" });
    const topicCtx = buildAdvisorContext(defaultSettings, {
      windowTitle: "react hooks - Google Search",
    });
    const topicPrompt = buildAdvisorAngleIntent(topicCtx, "topic");
    expect(topicPrompt?.length ?? 0).toBeGreaterThan(20);
  });

  it("detects actionable advisor signals without a specific angle", () => {
    const weakCtx = buildAdvisorContext(defaultSettings, {});
    expect(selectAdvisorAngle(weakCtx)).toBeNull();
    expect(hasActionableAdvisorSignals(weakCtx)).toBe(false);

    recordQueryTopic({ topic: "vitest mocks", source: "browser" });
    const strongCtx = buildAdvisorContext(defaultSettings, {
      windowTitle: "auth.ts - desktop-character - Cursor",
    });
    expect(hasActionableAdvisorSignals(strongCtx)).toBe(true);
  });

  it("adds clipboard code as a conversation topic", () => {
    recordClipboardSignal({
      clipKind: "code",
      snippet: "export function pickPlannedInitiativeAnchor() {}",
    });
    const bundle = buildInitiativeSignalBundle(defaultSettings, {
      windowTitle: "advisorEngine.ts - desktop-character - Cursor",
      processName: "Code.exe",
    });
    const topics = buildConversationTopics(bundle.advisor, 5, [], bundle);
    expect(
      topics.some((topic) => /буфер|код|advisorEngine/i.test(topic)),
    ).toBe(true);
  });

  it("builds conversation topics from recent activity", () => {
    recordQueryTopic({ topic: "vitest mocks", source: "chat" });
    const ctx = buildAdvisorContext(defaultSettings, {
      windowTitle: "auth.ts - desktop-character - Cursor",
    });
    const topics = buildConversationTopics(ctx);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.some((topic) => /auth\.ts/i.test(topic))).toBe(true);
    expect(topics.some((topic) => /vitest/i.test(topic))).toBe(false);
  });

  it("includes browser search topics but not chat messages", () => {
    recordQueryTopic({ topic: "vitest mocks", source: "chat" });
    recordQueryTopic({ topic: "tauri window permissions", source: "browser" });
    const ctx = buildAdvisorContext(defaultSettings, {
      windowTitle: "auth.ts - desktop-character - Cursor",
    });
    const topics = buildConversationTopics(ctx);
    expect(topics.some((topic) => /tauri window permissions/i.test(topic))).toBe(
      true,
    );
    expect(topics.some((topic) => /vitest/i.test(topic))).toBe(false);
  });

  it("drops stale browser topics that are not in the active window", () => {
    const staleAt = Date.now() - 2 * 60 * 60 * 1000;
    recordQueryTopic({
      topic: "AI Art Generator | PixAI",
      source: "browser",
      at: staleAt,
    });
    const ctx = buildAdvisorContext(defaultSettings, {
      windowTitle: "ChatPanel.tsx - desktop-character - Cursor",
    });
    const topics = buildConversationTopics(ctx);
    expect(topics.some((topic) => /pixai/i.test(topic))).toBe(false);
  });

  it("rotates planned anchor away from recently used topics", () => {
    rememberProactiveTopic("что нашёл по «AI Art Generator | PixAI»");
    const topics = [
      "что нашёл по «AI Art Generator | PixAI»",
      "как идёт ChatPanel.tsx",
    ];
    const anchor = pickPlannedInitiativeAnchor(topics, {
      recentProactive: ["PixAI art generator examples"],
      dominantFile: "ChatPanel.tsx",
    });
    expect(anchor).toBe("как идёт ChatPanel.tsx");
    expect(topicOverlapsRecent(anchor ?? "", ["PixAI art generator"])).toBe(
      false,
    );
  });
});
