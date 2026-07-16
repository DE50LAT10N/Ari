import { describe, expect, it } from "vitest";
import {
  classifyUserIntent,
  isHighConfidenceIntent,
} from "../src/character/userIntent";

describe("userIntent", () => {
  it("detects task commands", () => {
    const result = classifyUserIntent("добавь задачу купить молоко");
    expect(result.intent).toBe("task_command");
    expect(isHighConfidenceIntent(result)).toBe(true);
  });

  it("detects emotional support", () => {
    const result = classifyUserIntent("мне грустно, поддержи");
    expect(result.intent).toBe("emotional_support");
  });

  it("detects technical help", () => {
    const result = classifyUserIntent("почему не работает сборка tauri");
    expect(result.intent).toBe("technical_help");
  });

  it("detects LeetCode problem paste as technical help", () => {
    const result = classifyUserIntent(
      "You are given two non-empty linked lists representing two non-negative integers. Return the sum as a linked list. Example 1: Input: l1 = [2,4,3]",
    );
    expect(result.intent).toBe("technical_help");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });
});
