import { describe, expect, it } from "vitest";
import {
  findOpenTaskInHistory,
  looksLikeAffirmativeContinuation,
  looksLikeContinuationFollowUp,
  looksLikeHelpRequest,
  looksLikeTaskOrProblemStatement,
  shouldContinueOpenTask,
  userPresentedTask,
} from "../src/character/taskShape";
import { classifyResponseMode } from "../src/character/responseModes";
import { classifyUserIntent } from "../src/character/userIntent";
import { chooseResponseLength } from "../src/app/replyResponseLength";
import { isEngineeringRequest } from "../src/mentor/mentorModes";

const LEETCODE_ADD_TWO_NUMBERS = `You are given two non-empty linked lists representing two non-negative integers. The digits are stored in reverse order, and each of their nodes contains a single digit. Add the two numbers and return the sum as a linked list. You may assume the two numbers do not contain any leading zero, except the number 0 itself.

Example 1:
Input: l1 = [2,4,3], l2 = [5,6,4]
Output: [7,0,8]
Explanation: 342 + 465 = 807.

Constraints:
The number of nodes in each linked list is in the range [1, 100].`;

const OPEN_TASK_HISTORY = [
  { role: "user", content: LEETCODE_ADD_TWO_NUMBERS },
  {
    role: "assistant",
    content: "О, снова про цифры в обратном порядке? Давай разберёмся вместе.",
  },
];

describe("taskShape", () => {
  it("detects LeetCode-style problem statements", () => {
    expect(looksLikeTaskOrProblemStatement(LEETCODE_ADD_TWO_NUMBERS)).toBe(true);
    expect(classifyResponseMode({ message: LEETCODE_ADD_TWO_NUMBERS })).toBe(
      "technical_help",
    );
    expect(classifyUserIntent(LEETCODE_ADD_TWO_NUMBERS).intent).toBe(
      "technical_help",
    );
    expect(isEngineeringRequest(LEETCODE_ADD_TWO_NUMBERS)).toBe(true);
    expect(chooseResponseLength(LEETCODE_ADD_TWO_NUMBERS, 0, false)).toBe("long");
  });

  it("detects Russian help-with-task requests", () => {
    expect(looksLikeHelpRequest("Можешь помочь с этой задачей")).toBe(true);
    expect(looksLikeTaskOrProblemStatement("Помоги с этой задачей на литкоде")).toBe(
      true,
    );
    expect(
      classifyResponseMode({ message: "Помоги решить задачу: напиши функцию" }),
    ).toBe("technical_help");
  });

  it("marks a problem paste after an explicit help request as presented task", () => {
    expect(
      userPresentedTask(LEETCODE_ADD_TWO_NUMBERS, "Можешь помочь с этой задачей"),
    ).toBe(true);
  });

  it("detects short continuation follow-ups", () => {
    expect(looksLikeContinuationFollowUp("продолжи")).toBe(true);
    expect(looksLikeContinuationFollowUp("а код?")).toBe(true);
    expect(looksLikeContinuationFollowUp("сделай")).toBe(true);
    expect(looksLikeAffirmativeContinuation("Давай")).toBe(true);
    expect(looksLikeContinuationFollowUp("Давай")).toBe(true);
    expect(looksLikeContinuationFollowUp("спасибо")).toBe(false);
  });

  it("continues open task on Давай / Реши задачку after LeetCode history", () => {
    const historyWithDavai = [
      ...OPEN_TASK_HISTORY,
      { role: "user", content: "Давай" },
    ];
    expect(findOpenTaskInHistory(OPEN_TASK_HISTORY)?.role).toBe("user");
    expect(shouldContinueOpenTask("Давай", historyWithDavai)).toBe(true);
    expect(userPresentedTask("Давай", undefined, historyWithDavai)).toBe(true);
    expect(
      classifyResponseMode({
        message: "Давай",
        recentHistory: historyWithDavai,
      }),
    ).toBe("technical_help");
    expect(chooseResponseLength("Давай", 0, false, undefined, undefined, undefined, historyWithDavai)).toBe(
      "medium",
    );

    const historyWithSolve = [
      ...OPEN_TASK_HISTORY,
      { role: "user", content: "Реши задачку" },
    ];
    expect(shouldContinueOpenTask("Реши задачку", historyWithSolve)).toBe(true);
    expect(userPresentedTask("Реши задачку", undefined, historyWithSolve)).toBe(
      true,
    );
    expect(
      classifyResponseMode({
        message: "Реши задачку",
        recentHistory: historyWithSolve,
      }),
    ).toBe("technical_help");
  });

  it("does not treat chat invite as open-task continuation", () => {
    expect(looksLikeAffirmativeContinuation("Давай просто поговорим")).toBe(false);
    expect(
      classifyResponseMode({
        message: "Давай просто поговорим",
        recentHistory: OPEN_TASK_HISTORY,
      }),
    ).not.toBe("technical_help");
  });

  it("does not treat plain smalltalk as a task", () => {
    expect(looksLikeTaskOrProblemStatement("Как настроение сегодня?")).toBe(false);
    expect(classifyResponseMode({ message: "Как настроение сегодня?" })).toBe(
      "direct_answer",
    );
  });
});

describe("task acknowledgement validation", () => {
  it("flags interview-prep meta replies when user presented a task", async () => {
    const { validateCharacterReply } = await import(
      "../src/character/responseValidation"
    );
    const result = validateCharacterReply(
      "Готовишься к собеседованию и решаешь задачи на Литкоде — отличный подход! Чем займёмся дальше?",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        userPresentedTask: true,
        responseMode: "technical_help",
      },
    );
    expect(result.issues).toContain("task acknowledgement only");
  });

  it("flags greeting reset and condition re-ask when user presented a task", async () => {
    const { validateCharacterReply } = await import(
      "../src/character/responseValidation"
    );
    const greeting = validateCharacterReply(
      "Привет! Решать задачки или просто поболтаем?",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        userPresentedTask: true,
        responseMode: "technical_help",
      },
    );
    expect(greeting.issues).toContain("task acknowledgement only");

    const reask = validateCharacterReply(
      "Давай задачку! Что именно хочешь решить? Твои условия — мои инструменты.",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        userPresentedTask: true,
        responseMode: "technical_help",
      },
    );
    expect(reask.issues).toContain("task acknowledgement only");
  });

  it("allows a substantive task reply", async () => {
    const { validateCharacterReply } = await import(
      "../src/character/responseValidation"
    );
    const result = validateCharacterReply(
      "Идём с переносом: складываем цифры узлов поразрядно, carry в следующий разряд, пока есть списки или перенос. Сложность O(n).",
      {
        hasVision: false,
        hasMemory: false,
        hasRag: false,
        userPresentedTask: true,
        responseMode: "technical_help",
      },
    );
    expect(result.issues).not.toContain("task acknowledgement only");
  });
});
