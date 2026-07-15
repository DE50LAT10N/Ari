import { formatReminderTime } from "../character/reminders";
import {
  addGoal,
  findGoalByTitle,
  getCurrentGoal,
  loadGoals,
  recordGoalProgress,
  setCurrentGoal,
  updateGoal,
} from "../tasks/goalLedger";
import {
  addTask,
  completeTask,
  completeTaskWithGoalInference,
  deferTask,
  formatTaskList,
  loadTasks,
  snoozeTask,
  updateTask,
  type Task,
} from "../tasks/taskStore";
import {
  classifyUserIntent,
  isHighConfidenceIntent,
} from "../character/userIntent";
import type { AppSettings } from "../settings/appSettings";
import type { CharacterEmotion } from "../types/character";
import type { CharacterMood } from "../character/mood";
import { wrapCommandReply } from "./commandCharacterWrap";
import { addUserMemoryFacts } from "../memory/userMemory";
import { tryHandleProductivityChatCommand } from "./productivityChat";
import { parseCommandTail } from "./commandTailParser";
import { isLlmProviderOnline } from "../llm/providerOnline";

type TaskCommandOutcome =
  | { handled: false }
  | {
      handled: true;
      reply: string;
      command: string;
      emotion: CharacterEmotion;
    };

function handled(command: string, body: string): TaskCommandOutcome {
  const wrapped = wrapCommandReply(command, body);
  return {
    handled: true,
    command,
    reply: wrapped.reply,
    emotion: wrapped.emotion,
  };
}

export function parseTaskTitleAndDue(
  raw: string,
  now = new Date(),
): { title: string; dueAt?: number } {
  let text = raw.trim().replace(/\s+/g, " ");

  const tomorrowMatch = text.match(
    /^завтра\s+(?:в\s+)?(\d{1,2})[.:](\d{2})\s+(.+)$/i,
  );
  if (tomorrowMatch) {
    const due = buildDueTime(
      now,
      Number(tomorrowMatch[1]),
      Number(tomorrowMatch[2]),
      1,
    );
    return { title: tomorrowMatch[3].trim(), dueAt: due };
  }

  const timeSuffix =
    text.match(/\s+на\s+(\d{1,2})[.:](\d{2})\s*$/i) ??
    text.match(/\s+в\s+(\d{1,2})[.:](\d{2})\s*$/i);
  if (timeSuffix) {
    const due = buildDueTime(
      now,
      Number(timeSuffix[1]),
      Number(timeSuffix[2]),
      0,
    );
    return {
      title: text.slice(0, timeSuffix.index).trim(),
      dueAt: due,
    };
  }

  return { title: text };
}

function buildDueTime(
  now: Date,
  hours: number,
  minutes: number,
  dayOffset: number,
): number | undefined {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return undefined;
  }
  const due = new Date(now);
  due.setDate(due.getDate() + dayOffset);
  due.setHours(hours, minutes, 0, 0);
  if (dayOffset === 0 && due.getTime() <= now.getTime()) {
    due.setDate(due.getDate() + 1);
  }
  return due.getTime();
}

function findOpenTaskByTitle(fragment: string): Task | null {
  const norm = fragment.trim().toLowerCase();
  if (!norm) return null;
  const tasks = loadTasks({ status: "open", includeDone: false });
  return (
    tasks.find((task) => task.title.toLowerCase() === norm) ??
    tasks.find((task) => task.title.toLowerCase().includes(norm)) ??
    tasks.find((task) => norm.includes(task.title.toLowerCase())) ??
    null
  );
}

function addTaskFromParsed(
  title: string,
  dueAt: number | undefined,
  sourceMessage: string,
  _mood?: CharacterMood,
): TaskCommandOutcome {
  if (!title.trim()) {
    return handled("task-add", "Напиши, что добавить: «добавь задачу …».");
  }
  const task = addTask({
    title: title.trim(),
    kind: dueAt ? "reminder" : "task",
    status: "open",
    priority: "normal",
    dueAt,
    source: "user",
    sourceMessage,
  });
  const goal = task.goalId ? loadGoals().find((item) => item.id === task.goalId) : null;
  const dueLine = task.dueAt
    ? ` Срок: ${formatReminderTime(task.dueAt)}.`
    : "";
  const goalLine = goal ? ` Цель: «${goal.title}».` : "";
  return handled(
    "task-add",
    `Добавила в «Дела»: «${task.title}».${dueLine}${goalLine} Панель слева от меня обновится.`,
  );
}

function addTaskFromText(
  rawTitle: string,
  sourceMessage: string,
  mood?: CharacterMood,
): TaskCommandOutcome {
  const { title, dueAt } = parseTaskTitleAndDue(rawTitle);
  return addTaskFromParsed(title, dueAt, sourceMessage, mood);
}

export function tryHandleTaskChatCommand(
  rawInput: string,
  mood?: CharacterMood,
): TaskCommandOutcome {
  const input = rawInput.trim();
  const lower = input.toLowerCase().replace(/\s+/g, " ");
  if (!input) return { handled: false };

  const addGoalMatch =
    input.match(/^добавь\s+цель\s+(.+)$/i) ??
    input.match(/^создай\s+цель\s+(.+)$/i) ??
    input.match(/^новая\s+цель\s*[:\-]?\s*(.+)$/i) ??
    input.match(/^поставь\s+цель\s+(.+)$/i) ??
    input.match(/^цель[:\s]+(.+)$/i);
  if (addGoalMatch?.[1]) {
    const raw = addGoalMatch[1].trim();
    const progressMatch = raw.match(/\s+(\d{1,3})%\s*$/);
    const title = progressMatch ? raw.slice(0, progressMatch.index).trim() : raw;
    if (!title) {
      return handled("goal-add", "Напиши цель после команды.");
    }
    const goal = addGoal({
      title,
      progress: progressMatch ? Number(progressMatch[1]) : 0,
      current: true,
    });
    return handled(
      "goal-add",
      `Цель добавлена и взята в фокус: «${goal.title}» (${goal.progress}%).`,
    );
  }

  if (/^(цели|список целей|покажи цели)$/i.test(lower)) {
    const goals = loadGoals();
    if (!goals.length) {
      return handled("goal-list", "Целей пока нет. Можно сказать: «добавь цель …».");
    }
    const lines = goals.slice(0, 8).map((goal) => {
      const marker = goal.current ? "→ " : "• ";
      const focus = goal.lastFocus ? ` — ${goal.lastFocus}` : "";
      return `${marker}${goal.title} — ${goal.progress}%${focus}`;
    });
    return handled("goal-list", ["Цели:", ...lines].join("\n"));
  }

  const focusGoalMatch =
    input.match(/^фокус\s+на\s+цель\s+(.+)$/i) ??
    input.match(/^текущая\s+цель\s+(.+)$/i);
  if (focusGoalMatch?.[1]) {
    const goal = findGoalByTitle(focusGoalMatch[1]);
    if (!goal || goal.status !== "active") {
      return handled("goal-focus", `Не нашла активную цель «${focusGoalMatch[1].trim()}».`);
    }
    setCurrentGoal(goal.id);
    return handled("goal-focus", `Текущая цель: «${goal.title}». Новые задачи буду цеплять к ней.`);
  }

  const progressGoalMatch =
    input.match(/^прогресс\s+цели\s+(.+?)\s+(\d{1,3})%$/i) ??
    input.match(/^цель\s+(.+?)\s+прогресс\s+(\d{1,3})%$/i);
  if (progressGoalMatch?.[1] && progressGoalMatch[2]) {
    const goal = findGoalByTitle(progressGoalMatch[1]);
    if (!goal) {
      return handled("goal-progress", `Не нашла цель «${progressGoalMatch[1].trim()}».`);
    }
    const updated = recordGoalProgress(goal.id, {
      progress: Number(progressGoalMatch[2]),
      focus: "Прогресс обновлён вручную",
    });
    return handled(
      "goal-progress",
      updated
        ? `Прогресс цели «${updated.title}»: ${updated.progress}%.`
        : "Не удалось обновить цель.",
    );
  }

  const doneGoalMatch =
    input.match(/^цель\s+готова\s+(.+)$/i) ??
    input.match(/^заверши\s+цель\s+(.+)$/i);
  if (doneGoalMatch?.[1]) {
    const goal = findGoalByTitle(doneGoalMatch[1]);
    if (!goal) {
      return handled("goal-done", `Не нашла цель «${doneGoalMatch[1].trim()}».`);
    }
    const updated = updateGoal(goal.id, {
      status: "done",
      progress: 100,
      current: false,
      lastFocus: "Цель закрыта вручную",
    });
    return handled(
      "goal-done",
      updated ? `Цель закрыта: «${updated.title}».` : "Не удалось закрыть цель.",
    );
  }

  if (/^что\s+в\s+фокусе/i.test(lower) || /^какая\s+цель/i.test(lower)) {
    const goal = getCurrentGoal();
    return handled(
      "goal-current",
      goal
        ? `Сейчас в фокусе: «${goal.title}» — ${goal.progress}%.${goal.lastFocus ? ` Последнее: ${goal.lastFocus}.` : ""}`
        : "Текущая цель не выбрана.",
    );
  }

  const intent = classifyUserIntent(input);
  if (
    isHighConfidenceIntent(intent, 0.88) &&
    intent.intent === "task_command" &&
    !/^(?:добавь|напомни|создай|запиши|список|сделано|отложи)/i.test(lower)
  ) {
    return addTaskFromText(input, input, mood);
  }

  const tomorrowAdd = input.match(/^запиши\s+на\s+завтра\s+(.+)$/i);
  if (tomorrowAdd?.[1]) {
    const { title, dueAt } = parseTaskTitleAndDue(
      `завтра 9:00 ${tomorrowAdd[1]}`,
    );
    if (!title) {
      return handled("task-add", "Напиши, что добавить на завтра.");
    }
    const task = addTask({
      title,
      kind: "reminder",
      status: "open",
      priority: "normal",
      dueAt,
      source: "user",
      sourceMessage: input,
    });
    const dueLine = task.dueAt
      ? ` Срок: ${formatReminderTime(task.dueAt)}.`
      : "";
    return handled(
      "task-add",
      `Записала на завтра в «Дела»: «${task.title}».${dueLine}`,
    );
  }

  const addMatchers = [
    /^добавь\s+задач[уеаи]?\s+(.+)$/i,
    /^добавить\s+задач[уеаи]?\s+(.+)$/i,
    /^добавь\s+в\s+дела\s+(.+)$/i,
    /^положи\s+в\s+дела\s+(.+)$/i,
    /^внеси\s+в\s+дела\s+(.+)$/i,
    /^запиши\s+задач[уеаи]?\s+(.+)$/i,
    /^запиши\s+в\s+дела\s+(.+)$/i,
    /^создай\s+задач[уеаи]?\s+(.+)$/i,
    /^новая\s+задач[аеи]?\s*[:\-]?\s*(.+)$/i,
    /^(?:можешь\s+)?добав(?:ь|ить)\s+(?:мне\s+)?задач[уеаи]?\s+(.+)$/i,
  ];
  for (const pattern of addMatchers) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return addTaskFromText(match[1], input, mood);
    }
  }

  const reminderMatchers = [
    /^напомни(?:\s+мне)?\s+(?:о|об|про)?\s*(.+)$/i,
    /^создай\s+напоминание\s+(.+)$/i,
    /^поставь\s+напоминание\s+(.+)$/i,
    /^напоминание\s+(.+)$/i,
  ];
  for (const pattern of reminderMatchers) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return addTaskFromText(match[1], input, mood);
    }
  }

  if (
    /^список\s+задач/i.test(lower) ||
    /^мои\s+задачи/i.test(lower) ||
    /^что\s+в\s+делах/i.test(lower) ||
    /^что\s+у\s+меня\s+в\s+задачах/i.test(lower) ||
    /^покажи\s+задачи/i.test(lower) ||
    /^покажи\s+дела/i.test(lower)
  ) {
    const open = loadTasks({ status: "open" });
    const proposed = loadTasks({ status: "proposed" });
    const lines = [
      "Открытые:",
      formatTaskList(open),
      proposed.length
        ? ["", "Предложения:", formatTaskList(proposed)].join("\n")
        : "",
    ].filter(Boolean);
    return handled("task-list", lines.join("\n"));
  }

const completeMatchers = [
    /^заверш(?:и|ить)\s+задач[уеаи]?\s+(.+)$/i,
    /^отметь\s+выполненным\s+(.+)$/i,
    /^сделано[:\s]+(.+)$/i,
    /^сделала[:\s]+(.+)$/i,
    /^готово[:\s]+(.+)$/i,
    /^выполнено[:\s]+(.+)$/i,
  ];
  for (const pattern of completeMatchers) {
    const match = input.match(pattern);
    if (match?.[1]) {
      const task = findOpenTaskByTitle(match[1]);
      if (!task) {
        return handled(
          "task-complete",
          `Не нашла открытую задачу «${match[1].trim()}».`,
        );
      }
      completeTask(task.id);
      return handled("task-complete", `Отметила выполненной: «${task.title}».`);
    }
  }

  const deferMatchers = [
    /^отложи\s+задач[уеаи]?\s+(.+)$/i,
    /^отложи\s+(.+?)\s+на\s+час$/i,
    /^отложи\s+(.+)$/i,
  ];
  for (const pattern of deferMatchers) {
    const match = input.match(pattern);
    if (match?.[1]) {
      const task =
        findOpenTaskByTitle(match[1]) ??
        loadTasks({ status: "open" })[0] ??
        null;
      if (!task) {
        return handled("task-defer", "Открытых задач нет.");
      }
      if (/на\s+час$/i.test(input)) {
        snoozeTask(task.id, 60 * 60_000);
        return handled("task-defer", `Отложила на час: «${task.title}».`);
      }
      deferTask(task.id);
      return handled("task-defer", `Отложила на сутки: «${task.title}».`);
    }
  }

  const moveTomorrow = input.match(/^перенеси\s+(.+?)\s+на\s+завтра$/i);
  if (moveTomorrow?.[1]) {
    const task = findOpenTaskByTitle(moveTomorrow[1]);
    if (!task) {
      return handled(
        "task-defer",
        `Не нашла открытую задачу «${moveTomorrow[1].trim()}».`,
      );
    }
    const { dueAt } = parseTaskTitleAndDue("завтра 9:00");
    updateTask(task.id, { dueAt, kind: "reminder" });
    return handled(
      "task-defer",
      `Перенесла на завтра: «${task.title}»${
        dueAt ? ` (${formatReminderTime(dueAt)})` : ""
      }.`,
    );
  }

  if (/^что\s+next/i.test(lower) || /^что\s+дальше/i.test(lower)) {
    const open = loadTasks({ status: "open" });
    const next = open[0];
    return handled(
      "task-next",
      next
        ? `Следующее: «${next.title}»`
        : "Список дел пуст — можно добавить задачу.",
    );
  }

  return { handled: false };
}

export async function tryHandleTaskChatCommandAsync(
  rawInput: string,
  settings: AppSettings,
  mood?: CharacterMood,
  ollamaOnline: boolean | null = null,
): Promise<TaskCommandOutcome> {
  const input = rawInput.trim();
  if (!input) return { handled: false };

  const productivity = tryHandleProductivityChatCommand(input, settings, mood);
  if (productivity.handled) {
    return productivity;
  }

  const rememberMatch =
    input.match(/^(?:запомни|сохрани в память|запомни что|не забудь)[:\s]+(.+)$/isu) ??
    input.match(/^я\s+(?:обычно|всегда|часто|редко)\s+(.+)$/isu);
  if (rememberMatch?.[1]) {
    const fact = rememberMatch[1].trim();
    if (fact.length >= 4) {
      const result = await addUserMemoryFacts([fact], "manual");
      const body = result.changed
        ? `Запомнила: «${fact.slice(0, 160)}». Это в памяти о тебе.`
        : `Уже помню: «${fact.slice(0, 160)}».`;
      return handled("memory-remember", body);
    }
  }

  if (isLlmProviderOnline(settings, ollamaOnline)) {
    const addGoalMatch =
      input.match(/^добавь\s+цель\s+(.+)$/i) ??
      input.match(/^создай\s+цель\s+(.+)$/i) ??
      input.match(/^новая\s+цель\s*[:\-]?\s*(.+)$/i) ??
      input.match(/^поставь\s+цель\s+(.+)$/i) ??
      input.match(/^цель[:\s]+(.+)$/i);
    if (addGoalMatch?.[1]) {
      const parsed = await parseCommandTail(
        settings,
        "goal-add",
        addGoalMatch[1],
        input,
        ollamaOnline,
      );
      if (!parsed.execute) {
        return { handled: false };
      }
      const raw = parsed.title ?? addGoalMatch[1].trim();
      const progressMatch = raw.match(/\s+(\d{1,3})%\s*$/);
      const title = progressMatch ? raw.slice(0, progressMatch.index).trim() : raw;
      if (!title) {
        return handled("goal-add", "Напиши цель после команды.");
      }
      const goal = addGoal({
        title,
        progress: progressMatch ? Number(progressMatch[1]) : 0,
        current: true,
      });
      return handled(
        "goal-add",
        `Цель добавлена и взята в фокус: «${goal.title}» (${goal.progress}%).`,
      );
    }

    const addMatchers = [
      /^добавь\s+задач[уеаи]?\s+(.+)$/i,
      /^добавить\s+задач[уеаи]?\s+(.+)$/i,
      /^добавь\s+в\s+дела\s+(.+)$/i,
      /^положи\s+в\s+дела\s+(.+)$/i,
      /^внеси\s+в\s+дела\s+(.+)$/i,
      /^запиши\s+задач[уеаи]?\s+(.+)$/i,
      /^запиши\s+в\s+дела\s+(.+)$/i,
      /^создай\s+задач[уеаи]?\s+(.+)$/i,
      /^новая\s+задач[аеи]?\s*[:\-]?\s*(.+)$/i,
      /^(?:можешь\s+)?добав(?:ь|ить)\s+(?:мне\s+)?задач[уеаи]?\s+(.+)$/i,
    ];
    for (const pattern of addMatchers) {
      const match = input.match(pattern);
      if (match?.[1]) {
        const parsed = await parseCommandTail(
          settings,
          "task-add",
          match[1],
          input,
          ollamaOnline,
        );
        if (!parsed.execute) {
          return { handled: false };
        }
        return addTaskFromParsed(
          parsed.title ?? match[1],
          parsed.dueAt,
          input,
          mood,
        );
      }
    }

    const reminderMatchers = [
      /^напомни(?:\s+мне)?\s+(?:о|об|про)?\s*(.+)$/i,
      /^создай\s+напоминание\s+(.+)$/i,
      /^поставь\s+напоминание\s+(.+)$/i,
      /^напоминание\s+(.+)$/i,
    ];
    for (const pattern of reminderMatchers) {
      const match = input.match(pattern);
      if (match?.[1]) {
        const parsed = await parseCommandTail(
          settings,
          "reminder",
          match[1],
          input,
          ollamaOnline,
        );
        if (!parsed.execute) {
          return { handled: false };
        }
        return addTaskFromParsed(
          parsed.title ?? match[1],
          parsed.dueAt,
          input,
          mood,
        );
      }
    }
  }

  const completeMatchers = [
    /^заверш(?:и|ить)\s+задач[уеаи]?\s+(.+)$/i,
    /^отметь\s+выполненным\s+(.+)$/i,
    /^сделано[:\s]+(.+)$/i,
    /^сделала[:\s]+(.+)$/i,
    /^готово[:\s]+(.+)$/i,
    /^выполнено[:\s]+(.+)$/i,
  ];
  for (const pattern of completeMatchers) {
    const match = input.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    const task = findOpenTaskByTitle(match[1]);
    if (!task) {
      return handled(
        "task-complete",
        `Не нашла открытую задачу «${match[1].trim()}».`,
      );
    }
    const completed = await completeTaskWithGoalInference(task.id, settings);
    return handled(
      "task-complete",
      completed
        ? `Отметила выполненной: «${completed.title}».`
        : `Не удалось закрыть задачу «${task.title}».`,
    );
  }

  return tryHandleTaskChatCommand(rawInput, mood);
}
