import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type AppSettings } from "../src/settings/appSettings";
import type { CharacterMood } from "../src/character/mood";
import type { CharacterRelationship } from "../src/character/relationship";
import type { AriSelfMemory } from "../src/character/selfMemory";
import { buildReplyContext } from "../src/app/replyContextBuilder";

const mocks = vi.hoisted(() => ({
  searchRag: vi.fn(),
  getRagSearchMode: vi.fn(),
  loadRagClient: vi.fn(),
  loadLiveTools: vi.fn(),
  loadProactiveRuntime: vi.fn(),
  applyRetrievalRerank: vi.fn(),
}));

vi.mock("../src/app/chatRuntimeLoaders", () => ({
  loadRagClient: mocks.loadRagClient,
  loadLiveTools: mocks.loadLiveTools,
  loadProactiveRuntime: mocks.loadProactiveRuntime,
}));

vi.mock("../src/memory/retrievalRerank", () => ({
  applyRetrievalRerank: mocks.applyRetrievalRerank,
}));

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
    clear: () => storage.clear(),
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
}

const mood: CharacterMood = {
  warmth: 0.25,
  energy: 0.45,
  irritation: 0,
  updatedAt: 1_000,
};

const relationship: CharacterRelationship = {
  familiarity: 0.08,
  trust: 0.12,
  playfulness: 0.2,
  exchanges: 0,
  updatedAt: 1_000,
};

const selfMemory: AriSelfMemory = {
  repeatedJokesToAvoid: [],
  userPreferredTone: "playful",
  userDislikedBehaviors: [],
  successfulInteractionPatterns: [],
  updatedAt: 1_000,
};

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...defaultSettings,
    ragEnabled: false,
    userMemoryEnabled: false,
    webToolsEnabled: false,
    safeActionsEnabled: false,
    rerankEnabled: false,
    llmRerankEnabled: false,
    intentClassifierEnabled: false,
    moodEngineEnabled: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof buildReplyContext>[0]> = {}) {
  return {
    baseHistory: [{ role: "user" as const, content: "Как дела?" }],
    options: {},
    settings: settings(),
    activeWindow: null,
    ollamaOnline: true,
    mood,
    relationship,
    attention: "listening" as const,
    scene: "focus" as const,
    selfMemory,
    streamedEmotion: "neutral" as const,
    setLiveToolStatus: vi.fn(),
    logError: vi.fn(),
    ariLog: vi.fn(),
    ...overrides,
  };
}

describe("buildReplyContext", () => {
  beforeEach(() => {
    setupStorage();
    vi.clearAllMocks();
    mocks.searchRag.mockResolvedValue([]);
    mocks.getRagSearchMode.mockReturnValue("none");
    mocks.loadRagClient.mockResolvedValue({
      searchRag: mocks.searchRag,
      getRagSearchMode: mocks.getRagSearchMode,
    });
    mocks.loadLiveTools.mockResolvedValue(null);
    mocks.loadProactiveRuntime.mockResolvedValue({ runtime: true });
    mocks.applyRetrievalRerank.mockImplementation(async (input) => ({
      rag: input.ragMatches,
      facts: input.facts,
      episodes: input.episodes,
    }));
  });

  it("builds an empty context without retrieval or live tool calls", async () => {
    const setLiveToolStatus = vi.fn();
    const result = await buildReplyContext(baseInput({ setLiveToolStatus }));

    expect(result.lastUserMessage).toBe("Как дела?");
    expect(result.fittedHistory).toHaveLength(1);
    expect(result.processReplyOptions.validationContext.hasRag).toBe(false);
    expect(result.processReplyOptions.validationContext.hasMemory).toBe(true);
    expect(result.processReplyOptions.validationContext.hasLiveTool).toBe(false);
    expect(mocks.loadRagClient).not.toHaveBeenCalled();
    expect(setLiveToolStatus).toHaveBeenCalledWith(null);
  });

  it("adds RAG context and clears live tool status after retrieval", async () => {
    const setLiveToolStatus = vi.fn();
    mocks.searchRag.mockResolvedValue([
      { text: "Документ говорит: держать генерацию в hook.", source: "notes.md" },
    ]);

    const result = await buildReplyContext(
      baseInput({
        settings: settings({ ragEnabled: true }),
        setLiveToolStatus,
      }),
    );

    expect(mocks.loadRagClient).toHaveBeenCalledTimes(1);
    expect(result.runtimeContext.memory).toHaveLength(1);
    expect(result.processReplyOptions.validationContext.hasRag).toBe(true);
    expect(setLiveToolStatus).toHaveBeenLastCalledWith(null);
  });

  it("returns proactive runtime and proactive validation flags", async () => {
    const result = await buildReplyContext(
      baseInput({
        options: {
          proactive: true,
          initiativeKind: "check_in",
          proactiveReplyTone: "smalltalk",
        },
      }),
    );

    expect(mocks.loadProactiveRuntime).toHaveBeenCalledTimes(1);
    expect(result.proactiveLlm).toEqual({ runtime: true });
    expect(result.processReplyOptions.validationContext.proactive).toBe(true);
    expect(result.proactiveReplyTone).toBe("smalltalk");
  });
});
