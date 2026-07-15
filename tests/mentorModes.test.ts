import { describe, expect, it } from "vitest";
import {
  buildMentorModePolicy,
  classifyMentorMode,
  createMentorTask,
  isEngineeringRequest,
} from "../src/mentor/mentorModes";

describe("Engineering Mentor modes", () => {
  it.each([
    ["Сделай ревью этого кода", "mentor_review"],
    ["Почему падает этот тест?", "mentor_debug"],
    ["Сравни варианты архитектуры сервиса", "mentor_architecture"],
    ["Объясни структуру проекта", "project_understanding"],
    ["Научи меня отлаживать React", "mentor_learning"],
    ["Реализуй исправление в файле", "implementation"],
  ] as const)("classifies %s", (message, expected) => {
    expect(classifyMentorMode(message)).toBe(expected);
  });

  it("does not route ordinary conversation into the mentor", () => {
    expect(isEngineeringRequest("Как прошёл твой день?")).toBe(false);
    expect(isEngineeringRequest("В TypeScript падает сборка")).toBe(true);
  });

  it("keeps implementation read-only without explicit capabilities", () => {
    const task = createMentorTask("Реализуй исправление");
    expect(task.authorization.editFiles).toBe(false);
    expect(buildMentorModePolicy(task)).toContain("File editing is not authorized");
  });
});
