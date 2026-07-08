import { describe, expect, it } from "vitest";
import { classifyClipboardSignal } from "../src/platform/clipboardClassifier";
import { classifyClipboardText } from "../src/platform/clipboard";

describe("clipboard classifier", () => {
  it("uses URL parsing for web links", () => {
    expect(classifyClipboardSignal("https://example.com/path?q=1").kind).toBe(
      "url",
    );
    expect(classifyClipboardSignal("www.example.com/docs").kind).toBe("url");
  });

  it("recognizes stack frames and diagnostics", () => {
    expect(
      classifyClipboardSignal(
        "TypeError: bad\n    at run (src/app/ChatPanel.tsx:42:10)",
      ).kind,
    ).toBe("stacktrace");
    expect(classifyClipboardText("npm ERR! Cannot find module vite")).toBe(
      "diagnostic",
    );
  });

  it("keeps structured notation compatible as code", () => {
    expect(classifyClipboardText("Input{User message} --> Cmd{Chat command?}")).toBe(
      "code",
    );
  });
});
