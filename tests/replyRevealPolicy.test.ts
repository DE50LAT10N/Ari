import { describe, expect, it } from "vitest";
import { requiresValidatedReveal } from "../src/app/replyGenerationPolicy";

describe("reply reveal policy", () => {
  it("keeps ordinary conversation streaming", () => {
    expect(
      requiresValidatedReveal({
        mood: "calm",
        mentorTaskGoal: "explain TypeScript generics",
      }),
    ).toBe(false);
  });

  it.each([
    { memory: [{ source: "memory", text: "fact" }] },
    { liveToolContext: "fresh web result" },
    { screenObservation: { title: "IDE", processName: "Code", text: "code" } },
    { ideMentorEvidence: "snapshot evidence" },
  ])("hides the draft until validation for dynamic evidence", (context) => {
    expect(requiresValidatedReveal(context)).toBe(true);
  });
});
