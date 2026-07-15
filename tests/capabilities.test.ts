import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCapabilitiesOverview } from "../src/chat/capabilitiesOverview";
import { tryHandleChatCommand } from "../src/chat/chatCommands";
import { defaultSettings } from "../src/settings/appSettings";

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
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("capabilities", () => {
  beforeEach(() => {
    setupStorage();
  });

  it("buildCapabilitiesOverview includes key sections", () => {
    const text = buildCapabilitiesOverview(defaultSettings);
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("=== Chat & personality ===");
    expect(text).toContain("=== Memory (your config) ===");
    expect(text).toContain("=== Initiative & companion ===");
    expect(text).toContain("smalltalk ~3 min");
    expect(text).toContain("advice ~5 min");
    expect(text).toContain("docs/COMMANDS.md");
  });

  it("reflects disabled memory in overview", () => {
    const text = buildCapabilitiesOverview({
      ...defaultSettings,
      userMemoryEnabled: false,
      proactiveEnabled: false,
    });
    expect(text).toContain("Long-term facts: off");
    expect(text).toContain("Proactive messages: off");
  });

  it("handles «что ты умеешь» as capabilities command", async () => {
    const result = await tryHandleChatCommand("что ты умеешь", defaultSettings);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.command).toBe("capabilities");
    expect(result.reply).toContain("Chat & personality");
  });

  it("handles help alias", async () => {
    const result = await tryHandleChatCommand("help", defaultSettings);
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.command).toBe("capabilities");
  });
});
