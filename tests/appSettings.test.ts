import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSettings,
  loadSettings,
  normalizeSettings,
} from "../src/settings/appSettings";

const SETTINGS_KEY = "desktop-character.settings.v1";

function setupStorage(): Map<string, string> {
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
  return storage;
}

describe("appSettings proactive interval migration", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = setupStorage();
  });

  it("splits legacy proactive interval into advice and smalltalk clocks", () => {
    storage.set(
      SETTINGS_KEY,
      JSON.stringify({
        proactiveIntervalMinutes: 30,
      }),
    );

    const settings = loadSettings();

    expect(settings.proactiveAdviceIntervalMinutes).toBe(5);
    expect(settings.proactiveSmalltalkIntervalMinutes).toBe(3);
    expect(settings.proactiveIntervalMinutes).toBe(5);
    expect(settings.initiativeLevel).toBe("active");
  });

  it("keeps explicit dual timer settings and mirrors legacy alias to advice", () => {
    storage.set(
      SETTINGS_KEY,
      JSON.stringify({
        proactiveIntervalMinutes: 30,
        proactiveAdviceIntervalMinutes: 12,
        proactiveSmalltalkIntervalMinutes: 7,
      }),
    );

    const settings = loadSettings();

    expect(settings.proactiveAdviceIntervalMinutes).toBe(5);
    expect(settings.proactiveSmalltalkIntervalMinutes).toBe(3);
    expect(settings.proactiveIntervalMinutes).toBe(5);
  });

  it("keeps proactive signal sources enabled by default", () => {
    expect(defaultSettings.clipboardFullCaptureEnabled).toBe(true);
    expect(defaultSettings.embeddingSource).toBe("ollama");
    expect(defaultSettings.visionSource).toBe("ollama");
    expect(defaultSettings.ideAdvisorEnabled).toBe(true);
    expect(defaultSettings.webToolsEnabled).toBe(true);
  });

  it("migrates an existing installation to the proactive-first profile", () => {
    storage.set(
      SETTINGS_KEY,
      JSON.stringify({
        onboardingCompleted: true,
        proactiveEnabled: false,
        eventReactionsEnabled: false,
        activityTrackingEnabled: false,
        advisorEnabled: false,
        clipboardFullCaptureEnabled: false,
        webToolsEnabled: false,
      }),
    );

    const settings = loadSettings();

    expect(settings.proactiveEnabled).toBe(true);
    expect(settings.eventReactionsEnabled).toBe(true);
    expect(settings.activityTrackingEnabled).toBe(true);
    expect(settings.advisorEnabled).toBe(true);
    expect(settings.ideAdvisorEnabled).toBe(true);
    expect(settings.adviceCodeReadingEnabled).toBe(true);
    expect(settings.clipboardFullCaptureEnabled).toBe(true);
    expect(settings.webToolsEnabled).toBe(true);
    expect(settings.privacyConsentVersion).toBe(
      defaultSettings.privacyConsentVersion,
    );
  });

  it("keeps the unrestricted experimental context profile after migration", () => {
    storage.set(
      SETTINGS_KEY,
      JSON.stringify({
        onboardingCompleted: true,
        proactiveEnabled: false,
        activityTrackingEnabled: false,
        clipboardFullCaptureEnabled: false,
        webToolsEnabled: false,
      }),
    );

    expect(loadSettings().proactiveEnabled).toBe(true);
    storage.set(
      SETTINGS_KEY,
      JSON.stringify({
        ...defaultSettings,
        onboardingCompleted: true,
        proactiveEnabled: false,
        activityTrackingEnabled: false,
        clipboardFullCaptureEnabled: false,
        webToolsEnabled: false,
      }),
    );

    const settings = loadSettings();
    expect(settings.proactiveEnabled).toBe(true);
    expect(settings.activityTrackingEnabled).toBe(true);
    expect(settings.clipboardFullCaptureEnabled).toBe(true);
    expect(settings.clipboardObservationEnabled).toBe(true);
    expect(settings.autoVisionEnabled).toBe(true);
    expect(settings.activityAllowlist).toBe("");
    expect(settings.ideAdvisorEnabled).toBe(true);
    expect(settings.adviceCodeReadingEnabled).toBe(true);
    expect(settings.webToolsEnabled).toBe(false);
  });

  it("preserves explicit opt-ins recorded under the current consent version", () => {
    const settings = normalizeSettings({
      privacyConsentVersion: defaultSettings.privacyConsentVersion,
      clipboardFullCaptureEnabled: true,
      webToolsEnabled: true,
    });

    expect(settings.clipboardFullCaptureEnabled).toBe(true);
    expect(settings.webToolsEnabled).toBe(true);
  });

  it("normalizes imported values and enforces the context reserve", () => {
    const settings = normalizeSettings({
      temperature: 99,
      contextTokens: 2048,
      maxTokens: 999_999,
      ragTopK: -4,
      quietHoursStart: 50,
      llmProvider: "unknown",
      ollamaBaseUrl: "file:///tmp/model",
      recallLexicalWeight: 0,
      recallSemanticWeight: 0,
    });

    expect(settings.temperature).toBe(2);
    expect(settings.contextTokens).toBe(2048);
    expect(settings.maxTokens).toBe(1792);
    expect(settings.ragTopK).toBe(1);
    expect(settings.quietHoursStart).toBe(23);
    expect(settings.llmProvider).toBe("ollama");
    expect(settings.ollamaBaseUrl).toBe(defaultSettings.ollamaBaseUrl);
    expect(settings.recallLexicalWeight).toBe(defaultSettings.recallLexicalWeight);
    expect(settings.recallSemanticWeight).toBe(defaultSettings.recallSemanticWeight);
  });
});
