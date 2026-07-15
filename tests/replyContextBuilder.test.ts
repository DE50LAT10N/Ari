import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type AppSettings } from "../src/settings/appSettings";
import type { CharacterMood } from "../src/character/mood";
import type { CharacterRelationship } from "../src/character/relationship";
import type { AriSelfMemory } from "../src/character/selfMemory";
import { buildReplyContext } from "../src/app/replyContextBuilder";
import type { IdeWorkspaceSnapshot } from "../src/ide/protocol";

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
    mocks.searchRag.mockResolvedValue({
      matches: [],
      chunkCount: 0,
      searchMode: "none",
    });
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
    expect(result.processReplyOptions.validationContext.hasMemory).toBe(false);
    expect(result.processReplyOptions.validationContext.hasLiveTool).toBe(false);
    expect(result.processReplyOptions.userAskedQuestion).toBe(true);
    expect(mocks.loadRagClient).not.toHaveBeenCalled();
    expect(setLiveToolStatus).toHaveBeenCalledWith(null);
  });

  it("adds RAG context and clears live tool status after retrieval", async () => {
    const setLiveToolStatus = vi.fn();
    mocks.searchRag.mockResolvedValue({
      matches: [
        {
          text: "Документ говорит: держать генерацию в hook.",
          source: "notes.md",
          score: 0.8,
        },
      ],
      chunkCount: 1,
      searchMode: "linear",
    });

    const result = await buildReplyContext(
      baseInput({
        settings: settings({ ragEnabled: true }),
        setLiveToolStatus,
      }),
    );

    expect(mocks.loadRagClient).toHaveBeenCalledTimes(1);
    expect(mocks.searchRag).toHaveBeenCalledWith(
      "Как дела?",
      expect.objectContaining({ ragEnabled: true }),
      expect.objectContaining({
        plan: expect.objectContaining({ documentLookup: false }),
      }),
    );
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

  it("shows RAG status for proactive retrieval", async () => {
    const setLiveToolStatus = vi.fn();
    await buildReplyContext(
      baseInput({
        settings: settings({ ragEnabled: true }),
        options: { proactive: true, initiativeKind: "check_in" },
        setLiveToolStatus,
      }),
    );

    expect(setLiveToolStatus).toHaveBeenCalledWith("ищу в документах...");
    expect(setLiveToolStatus).toHaveBeenLastCalledWith(null);
  });

  it("enables read-only Engineering Mentor policy for coding requests", async () => {
    const result = await buildReplyContext(
      baseInput({
        baseHistory: [
          {
            role: "user",
            content: "Почему падает TypeScript build? Найди причину кратко.",
          },
        ],
      }),
    );

    expect(result.runtimeContext.mentorModePolicy).toContain(
      "Engineering Mentor mode: mentor_debug",
    );
    expect(result.runtimeContext.mentorModePolicy).toContain(
      "File editing is not authorized",
    );
    expect(result.runtimeContext.mentorTaskGoal).toContain("TypeScript build");
  });

  it("adds a fresh consented IDE snapshot as bounded untrusted mentor evidence", async () => {
    const now = Date.now();
    const ideSnapshot: IdeWorkspaceSnapshot = {
      workspaceId: "workspace-1",
      projectId: "project-1",
      roots: [{ uri: "file:///repo", name: "repo" }],
      revision: 4,
      capturedAt: now,
      expiresAt: now + 60_000,
      snapshotSha256: "a".repeat(64),
      provenance: {
        source: "ide_bridge",
        client: "vscode",
        clientInstanceId: "client-1",
        collectedAt: now,
        trust: "untrusted_external_data",
      },
      sharing: {
        shareActiveFile: true,
        shareSelection: false,
        shareUnsavedBuffers: false,
        shareDiagnostics: true,
        shareGitStatus: false,
        shareTestResults: false,
      },
      activeEditor: {
        uri: "file:///repo/src/app.ts",
        languageId: "typescript",
        documentVersion: 3,
        isDirty: false,
      },
      diagnostics: [
        {
          uri: "file:///repo/src/app.ts",
          range: {
            start: { line: 4, character: 2 },
            end: { line: 4, character: 8 },
          },
          severity: "error",
          message: "Type mismatch",
          source: "ts",
          code: "TS2322",
        },
      ],
    };

    const result = await buildReplyContext(
      baseInput({
        baseHistory: [
          { role: "user", content: "Debug this TypeScript error and explain the cause." },
        ],
        settings: settings({
          onboardingCompleted: true,
          ideAdvisorEnabled: true,
          adviceCodeReadingEnabled: true,
        }),
        ideSnapshot,
      }),
    );

    expect(result.runtimeContext.ideMentorEvidence).toContain("file:///repo/src/app.ts");
    expect(result.runtimeContext.ideMentorEvidence).toContain("Type mismatch");
    expect(result.runtimeContext.ideMentorEvidence).toContain(
      "untrusted_external_data",
    );
  });

  it("stops before retrieval when the originating run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(
      buildReplyContext(baseInput({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.loadRagClient).not.toHaveBeenCalled();
  });
});
