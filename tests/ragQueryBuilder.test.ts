import { describe, expect, it } from "vitest";
import {
  buildRagSearchPlan,
  hasDocumentLookupIntent,
  normalizeDocumentSourceName,
} from "../src/rag/ragQueryBuilder";

describe("ragQueryBuilder", () => {
  it("builds a multi-query plan for document question lookup", () => {
    const plan = buildRagSearchPlan(
      "Какой вопрос в документе Вопросы ПП под номером 4",
    );

    expect(plan.documentLookup).toBe(true);
    expect(plan.documentHint).toMatch(/вопросы пп/i);
    expect(plan.itemNumber).toBe(4);
    expect(plan.queries.length).toBeGreaterThanOrEqual(2);
    expect(plan.queries.some((query) => /вопросы пп/i.test(query))).toBe(true);
    expect(plan.queries.some((query) => /4/.test(query))).toBe(true);
  });

  it("marks explicit RAG requests and cleans meta phrases", () => {
    const plan = buildRagSearchPlan(
      "Посмотри через RAG какой вопрос в документе Вопросы ПП под номером 4",
    );

    expect(plan.explicitRag).toBe(true);
    expect(plan.documentLookup).toBe(true);
    expect(plan.queries[0]).not.toMatch(/через\s+rag/i);
  });

  it("detects document lookup intent", () => {
    expect(
      hasDocumentLookupIntent(
        "Какой вопрос в документе Вопросы ПП под номером 4",
      ),
    ).toBe(true);
    expect(hasDocumentLookupIntent("привет, как дела?")).toBe(false);
  });

  it("normalizes document source names", () => {
    expect(normalizeDocumentSourceName("Вопросы ПП.pdf")).toBe("вопросы пп");
    expect(normalizeDocumentSourceName('"Notes.md"')).toBe("notes");
  });
});
