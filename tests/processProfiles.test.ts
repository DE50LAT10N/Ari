import { describe, expect, it } from "vitest";
import {
  classifyProcessProfiles,
  looksLikeSourceFile,
  primaryProcessProfile,
} from "../src/platform/processProfiles";

describe("processProfiles", () => {
  it("classifies editor, terminal, and browser processes through normalized profiles", () => {
    expect(
      classifyProcessProfiles({
        processName: "Code.exe",
        title: "src/app/ChatPanel.tsx - desktop-character",
      }).ide,
    ).toBe(true);
    expect(primaryProcessProfile({ processName: "WindowsTerminal.exe" })).toBe(
      "terminal",
    );
    expect(primaryProcessProfile({ processName: "msedge.exe" })).toBe("browser");
  });

  it("uses source file extensions as structured IDE evidence", () => {
    expect(looksLikeSourceFile("src/character/proactiveEngine.ts")).toBe(true);
    expect(
      classifyProcessProfiles({
        processName: "unknown.exe",
        editorFile: "tests/relevanceRanker.test.ts",
      }).ide,
    ).toBe(true);
    expect(looksLikeSourceFile("daily notes")).toBe(false);
  });
});
