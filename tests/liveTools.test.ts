import { describe, expect, it } from "vitest";
import {
  parseDuckDuckGoResults,
  shouldConsiderLiveTools,
  stripHtmlToText,
} from "../src/tools/liveTools";
import { actionText } from "../src/tools/safeActions";
import type { SafeActionProposal } from "../src/tools/safeActions";

describe("liveTools", () => {
  it("stripHtmlToText removes tags and entities", () => {
    const html = "<p>Hello <strong>world</strong> &amp; friends</p>";
    expect(stripHtmlToText(html)).toBe("Hello world & friends");
  });

  it("parseDuckDuckGoResults extracts title and url", () => {
    const html = `
      <a class="result__a" href="https://example.com/page">Example Title</a>
      <a class="result__snippet">Short snippet here</a>
    `;
    const results = parseDuckDuckGoResults(html, 3);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Example Title");
    expect(results[0]?.url).toBe("https://example.com/page");
  });

  it("shouldConsiderLiveTools matches search and time phrases", () => {
    expect(shouldConsiderLiveTools("который сейчас час")).toBe(true);
    expect(shouldConsiderLiveTools("найди в интернете курс доллара")).toBe(
      true,
    );
    expect(shouldConsiderLiveTools("привет, как дела?")).toBe(false);
  });
});

describe("safeActions actionText", () => {
  const base: SafeActionProposal = {
    id: "1",
    type: "create_reminder",
    title: "test",
    status: "pending",
  };

  it("prefers content over target", () => {
    expect(
      actionText({ ...base, content: "from content", target: "from target" }),
    ).toBe("from content");
  });

  it("falls back to target when content is missing", () => {
    expect(actionText({ ...base, target: "from target" })).toBe("from target");
  });

  it("returns undefined for empty values", () => {
    expect(actionText({ ...base, content: "   " })).toBeUndefined();
  });
});
