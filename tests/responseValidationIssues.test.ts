import { describe, expect, it } from "vitest";
import {
  hasAnyReplyValidationIssue,
  hasReplyValidationIssue,
  type ReplyValidationIssue,
} from "../src/character/responseValidation";

describe("typed response validation issues", () => {
  it("checks issue unions without raw string branching", () => {
    const issues: ReplyValidationIssue[] = [
      "habitual trailing question",
      "duplicate proactive reply",
    ];

    expect(hasReplyValidationIssue(issues, "habitual trailing question")).toBe(
      true,
    );
    expect(
      hasAnyReplyValidationIssue(issues, [
        "identity leak",
        "duplicate proactive reply",
      ]),
    ).toBe(true);
  });
});
