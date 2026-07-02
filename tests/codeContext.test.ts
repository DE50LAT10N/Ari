import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../src/settings/appSettings";
import type { InitiativeSignalBundle } from "../src/character/initiativeContext";
import { loadCurrentCodeExcerpt, resolveEditorFileInProject } from "../src/character/codeContext";

vi.mock("../src/platform/projectCompanion", () => ({
  listBinderFiles: vi.fn(),
}));

vi.mock("../src/character/projectBinder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/character/projectBinder")>();
  return {
    ...actual,
    getActiveProjectBinder: vi.fn(),
    listRecentProjectFiles: vi.fn(),
    readProjectFile: vi.fn(),
  };
});

const binder = await import("../src/character/projectBinder");

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    llmProvider: "ollama",
    ollamaBaseUrl: "",
    ollamaModelsDir: "",
    model: "",
    gigaChatModel: "",
    gigaChatVisionModel: "",
    gigaChatEmbeddingModel: "",
    embeddingSource: "none",
    visionSource: "ollama",
    gigaChatScope: "GIGACHAT_API_PERS",
    temperature: 0.7,
    maxTokens: 1024,
    contextTokens: 8192,
    ragEnabled: false,
    embeddingModel: "",
    ragTopK: 4,
    ragScoreThreshold: 0.2,
    memoryRelevanceFloor: 0.12,
    codingProcessAllowlist: "",
    distractorProcessAllowlist: "",
    clipboardObservationEnabled: false,
    clipboardFullCaptureEnabled: false,
    advisorEnabled: true,
    activityTrackingEnabled: true,
    activityAllowlist: "",
    proactiveEnabled: true,
    proactiveIntervalMinutes: 30,
    proactiveSmalltalkIntervalMinutes: 25,
    proactiveAdviceIntervalMinutes: 25,
    proactiveOpenChat: false,
    userMemoryEnabled: false,
    eventReactionsEnabled: false,
    remindersEnabled: false,
    quietHoursStart: 0,
    quietHoursEnd: 0,
    safeActionsEnabled: false,
    visualMemoryMinutes: 0,
    visionModel: "",
    quietMode: "off",
    onboardingCompleted: true,
    userName: "",
    ariTone: "balanced",
    teasingLevel: "normal",
    warmthLevel: "normal",
    initiativeLevel: "normal",
    technicalDetail: "balanced",
    romanceMode: "disabled",
    nightBehavior: "normal",
    soundsEnabled: false,
    pomodoroEnabled: false,
    pomodoroFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    voiceStyle: "off",
    blipVolume: 0.35,
    blipPitch: 1,
    blipSpeed: 1,
    blipEmotionPitch: false,
    blipSpeakReplies: false,
    blipSpeakInitiative: false,
    blipSpeakPomodoro: false,
    blipShortRepliesOnly: false,
    blipMuteDuringFocus: false,
    blipMuteAtNight: false,
    blipMuteInQuietMode: false,
    blipMaxReplyChars: 400,
    autoUpdateEnabled: false,
    autoVisionEnabled: false,
    webToolsEnabled: false,
    avatarLivelinessEnabled: false,
    rerankEnabled: false,
    llmRerankEnabled: false,
    intentClassifierEnabled: false,
    adaptiveInitiativeEnabled: false,
    moodEngineEnabled: true,
    adviceCodeReadingEnabled: true,
    recallLexicalWeight: 0.4,
    recallSemanticWeight: 0.6,
    embeddingQueryCacheTtlSec: 300,
    ...overrides,
  };
}

function bundle(editorFile?: string, editorRepo?: string): InitiativeSignalBundle {
  return {
    advisor: {} as any,
    hasActionableSignals: true,
    projectContext: "",
    clipboardSnippets: [],
    focusBlockers: [],
    dailyStuck: [],
    advisorFlags: "",
    moodPrompt: "",
    editorFile,
    editorRepo,
  };
}

describe("codeContext", () => {
  beforeEach(() => {
    vi.mocked(binder.getActiveProjectBinder).mockReturnValue({
      id: "p1",
      name: "proj",
      rootPath: "C:\\proj",
      allowedExtensions: ["ts"],
      pinnedPaths: [],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(binder.listRecentProjectFiles).mockResolvedValue([
      { relativePath: "src/app/ChatPanel.tsx", modifiedAt: 0, sizeBytes: 10 },
      { relativePath: "src/other/ChatPanel.tsx", modifiedAt: 0, sizeBytes: 10 },
      { relativePath: "src/app/App.tsx", modifiedAt: 0, sizeBytes: 10 },
    ]);
    vi.mocked(binder.readProjectFile).mockResolvedValue("line1\nline2\nline3\n");
  });

  it("resolves pinned file by basename", async () => {
    vi.mocked(binder.getActiveProjectBinder).mockReturnValue({
      id: "p1",
      name: "proj",
      rootPath: "C:\\proj",
      allowedExtensions: ["ts"],
      pinnedPaths: ["src/deep/ChatPanel.tsx"],
      createdAt: 0,
      updatedAt: 0,
    });
    const resolved = await resolveEditorFileInProject({
      editorFile: "ChatPanel.tsx",
    });
    expect(resolved?.relativePath).toBe("src/deep/ChatPanel.tsx");
  });

  it("resolves editor basename within active ProjectBinder", async () => {
    const resolved = await resolveEditorFileInProject({
      editorFile: "ChatPanel.tsx",
      editorRepo: "app",
    });
    expect(resolved?.relativePath).toBe("src/app/ChatPanel.tsx");
  });

  it("returns null when no active project", async () => {
    vi.mocked(binder.getActiveProjectBinder).mockReturnValue(null);
    const resolved = await resolveEditorFileInProject({
      editorFile: "ChatPanel.tsx",
    });
    expect(resolved).toBeNull();
  });

  it("loads bounded code excerpt when gated on", async () => {
    const excerpt = await loadCurrentCodeExcerpt(
      baseSettings(),
      bundle("App.tsx", "app"),
    );
    expect(excerpt?.file).toBe("App.tsx");
    expect(excerpt?.text).toContain("line1");
  });

  it("returns null when code reading is disabled", async () => {
    const excerpt = await loadCurrentCodeExcerpt(
      baseSettings({ adviceCodeReadingEnabled: false }),
      bundle("App.tsx", "app"),
    );
    expect(excerpt).toBeNull();
  });
});

