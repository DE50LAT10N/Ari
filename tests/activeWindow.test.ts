import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/settings/appSettings";
import {
  getActiveWindowContext,
  loadLastExternalWindow,
} from "../src/platform/activeWindow";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
  });
}

describe("activeWindow", () => {
  beforeEach(() => {
    setupStorage();
    vi.mocked(invoke).mockReset();
  });

  it("keeps the last external window when Ari has focus", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        processName: "Cursor.exe",
        title: "ChatPanel.tsx - desktop-character - Cursor",
      })
      .mockResolvedValueOnce({
        processName: "desktop-character.exe",
        title: "Ari Desktop Character",
      });

    const first = await getActiveWindowContext(defaultSettings);
    const second = await getActiveWindowContext(defaultSettings);

    expect(first?.processName).toBe("Cursor.exe");
    expect(second?.processName).toBe("Cursor.exe");
    expect(loadLastExternalWindow()?.title).toContain("ChatPanel.tsx");
  });

  it("bypasses the process allowlist for the unrestricted experiment", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        processName: "Cursor.exe",
        title: "ChatPanel.tsx - desktop-character - Cursor",
      })
      .mockResolvedValueOnce({
        processName: "desktop-character.exe",
        title: "Ari Desktop Character",
      });

    await getActiveWindowContext(defaultSettings);
    const fallback = await getActiveWindowContext({
      ...defaultSettings,
      activityAllowlist: "chrome",
    });

    expect(fallback?.processName).toBe("Cursor.exe");
  });

  it("does not return Ari in bypass mode", async () => {
    vi.mocked(invoke).mockResolvedValue({
      processName: "desktop-character.exe",
      title: "Ari Desktop Character",
    });

    await expect(
      getActiveWindowContext(defaultSettings, { bypassPrivacyGate: true }),
    ).resolves.toBeNull();
  });
});
