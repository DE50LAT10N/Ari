import { describe, expect, it } from "vitest";
import { validateCharacterReply } from "../src/character/responseValidation";
import { collectProactiveSignalFacts } from "../src/character/proactiveLlmEngine";
import { resolveProactiveReplyTone } from "../src/character/proactiveTone";
import type { InitiativeSignalBundle } from "../src/character/initiativeContext";
import type { NewsItem } from "../src/news/types";

const base = {
  hasVision: false,
  hasMemory: false,
  hasRag: false,
  proactive: true,
  proactiveReplyTone: "smalltalk" as const,
  newsEvidence: {
    title: "NASA tests an optical communications link",
    summary: "NASA completed an optical communications test in a laboratory.",
    excerpt: "The optical link connected two laboratory systems.",
    publisher: "NASA Technology",
    publishedAt: Date.parse("2026-07-15T10:00:00Z"),
  },
};

describe("news reply grounding", () => {
  it("keeps news_comment smalltalk and excludes clipboard/diagnostics from synthesis facts", () => {
    const newsItem: NewsItem = {
      id: "n1", title: base.newsEvidence.title, summary: base.newsEvidence.summary,
      excerpt: base.newsEvidence.excerpt, publisher: base.newsEvidence.publisher,
      publishedAt: base.newsEvidence.publishedAt, fetchedAt: base.newsEvidence.publishedAt,
      url: "https://www.nasa.gov/technology/demo", topics: ["optical"], language: "en",
      verification: "feed_and_article", provenance: "untrusted_external_data", sourceWeight: 1,
    };
    const bundle = {
      editorFile: "private.ts",
      clipboardSnippets: [{ kind: "code", text: "RAW_CLIPBOARD_SECRET", at: Date.now() }],
    } as unknown as InitiativeSignalBundle;
    const facts = collectProactiveSignalFacts({ bundle, tone: "smalltalk", newsItem });
    expect(resolveProactiveReplyTone({ initiativeKind: "news_comment" })).toBe("smalltalk");
    expect(facts).toHaveLength(1);
    expect(JSON.stringify(facts)).not.toContain("RAW_CLIPBOARD_SECRET");
    expect(JSON.stringify(facts)).not.toContain("private.ts");
  });

  it("accepts an attributed entity grounded in evidence", () => {
    const result = validateCharacterReply("NASA Technology пишет, что NASA завершила лабораторный тест оптической связи.", base);
    expect(result.issues).not.toContain("news grounding");
    expect(result.issues).not.toContain("news unsupported detail");
  });

  it("rejects unrelated claims and invented numbers", () => {
    const result = validateCharacterReply("GitHub выпустил 42 новых модели.", base);
    expect(result.issues).toContain("news grounding");
    expect(result.issues).toContain("news unsupported detail");
  });
});
