import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "../src/settings/appSettings";

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

    expect(settings.proactiveAdviceIntervalMinutes).toBe(30);
    expect(settings.proactiveSmalltalkIntervalMinutes).toBe(15);
    expect(settings.proactiveIntervalMinutes).toBe(30);
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

    expect(settings.proactiveAdviceIntervalMinutes).toBe(12);
    expect(settings.proactiveSmalltalkIntervalMinutes).toBe(7);
    expect(settings.proactiveIntervalMinutes).toBe(12);
  });
});
