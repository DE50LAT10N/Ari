import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseTaskTitleAndDue,
  tryHandleTaskChatCommand,
} from "../src/chat/taskChatParse";
import { invalidateTaskCache } from "../src/tasks/taskStore";

function setupStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

describe("taskChatParse", () => {
  beforeEach(() => {
    setupStorage();
    invalidateTaskCache();
  });

  it("parses due time at end of title", () => {
    const now = new Date("2026-06-27T10:00:00");
    const parsed = parseTaskTitleAndDue(
      "Поиграть в видеоигру на 20.00",
      now,
    );
    expect(parsed.title).toBe("Поиграть в видеоигру");
    expect(parsed.dueAt).toBeTypeOf("number");
    const due = new Date(parsed.dueAt!);
    expect(due.getHours()).toBe(20);
    expect(due.getMinutes()).toBe(0);
  });

  it("adds task from chat command", () => {
    const result = tryHandleTaskChatCommand(
      "Добавь задачу Поиграть в видеоигру на 20.00",
    );
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.command).toBe("task-add");
    expect(result.reply).toContain("Поиграть в видеоигру");
  });

  it("lists tasks after add", () => {
    tryHandleTaskChatCommand("добавь задачу Тестовая задача");
    const list = tryHandleTaskChatCommand("список задач");
    expect(list.handled).toBe(true);
    if (!list.handled) return;
    expect(list.reply).toContain("Тестовая задача");
  });

  it("adds from «положи в дела»", () => {
    const result = tryHandleTaskChatCommand("положи в дела купить молоко");
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply).toContain("молоко");
  });

  it("adds from «внеси в дела»", () => {
    const result = tryHandleTaskChatCommand("внеси в дела созвон с командой");
    expect(result.handled).toBe(true);
  });

  it("schedules tomorrow from «запиши на завтра»", () => {
    const result = tryHandleTaskChatCommand("запиши на завтра отчёт");
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply).toContain("завтра");
  });

  it("completes via «отметь выполненным»", () => {
    tryHandleTaskChatCommand("добавь задачу Сверить тесты");
    const result = tryHandleTaskChatCommand("отметь выполненным Сверить тесты");
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply).toContain("выполнен");
  });

  it("completes via «сделала»", () => {
    tryHandleTaskChatCommand("добавь задачу Убрать стол");
    const result = tryHandleTaskChatCommand("сделала: Убрать стол");
    expect(result.handled).toBe(true);
  });

  it("snoozes for an hour", () => {
    tryHandleTaskChatCommand("добавь задачу Позвонить маме");
    const result = tryHandleTaskChatCommand("отложи Позвонить маме на час");
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply).toContain("час");
  });

  it("moves task to tomorrow", () => {
    tryHandleTaskChatCommand("добавь задачу Дедлайн отчёта");
    const result = tryHandleTaskChatCommand("перенеси Дедлайн отчёта на завтра");
    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.reply).toContain("завтра");
  });
});
