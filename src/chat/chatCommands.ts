import {
  getActiveProjectBinder,
  listRecentProjectFiles,
  pinProjectFile,
  readProjectFile,
  upsertProjectBinder,
  formatBinderFileAge,
} from "../character/projectBinder";
import {
  fetchGitFileDiff,
  fetchGitRecentCommits,
  fetchGitStatusSummary,
  type GitCommitEntry,
  type GitStatusSummary,
} from "../platform/projectCompanion";

const WRITE_VERBS =
  /\b(commit|push|pull|merge|rebase|reset|checkout|cherry-pick|revert|stash|tag|add|rm|mv)\b/i;

function assertGitReadOnlyIntent(text: string): void {
  if (WRITE_VERBS.test(text)) {
    throw new Error(
      "Git companion работает только в read-only режиме. Запись в репозиторий запрещена.",
    );
  }
}

async function getGitSummaryForActiveProject(): Promise<GitStatusSummary | null> {
  const project = getActiveProjectBinder();
  if (!project?.rootPath) return null;
  return fetchGitStatusSummary(project.rootPath);
}

async function getRecentCommitsForActiveProject(
  limit = 8,
): Promise<GitCommitEntry[]> {
  const project = getActiveProjectBinder();
  if (!project?.rootPath) return [];
  return fetchGitRecentCommits(project.rootPath, limit);
}

async function getDiffForActiveProject(
  relativePath?: string,
): Promise<string> {
  const project = getActiveProjectBinder();
  if (!project?.rootPath) {
    throw new Error("Активный проект не выбран.");
  }
  return fetchGitFileDiff(project.rootPath, relativePath);
}

function formatGitStatusSummary(summary: GitStatusSummary): string {
  if (!summary.isRepo) {
    return "В корне проекта нет git-репозитория.";
  }
  const lines = [
    `Ветка: ${summary.branch}`,
    `Изменённые: ${summary.changed.length}`,
    `Неотслеживаемые: ${summary.untracked.length}`,
    `В индексе: ${summary.staged.length}`,
  ];
  if (summary.changed.length) {
    lines.push("", "Изменённые:", ...summary.changed.slice(0, 12).map((p) => `• ${p}`));
  }
  if (summary.untracked.length) {
    lines.push("", "Неотслеживаемые:", ...summary.untracked.slice(0, 12).map((p) => `• ${p}`));
  }
  return lines.join("\n");
}

function formatRecentCommits(commits: GitCommitEntry[]): string {
  if (!commits.length) return "Коммитов пока нет.";
  return commits.map((entry) => `${entry.hash} — ${entry.subject}`).join("\n");
}

import {
  addBacklogItem,
  deferBacklogItem,
  getNextBacklogItem,
  loadBacklogItems,
} from "../character/ariBacklog";
import {
  addActiveFocusBlocker,
  addActiveFocusTask,
  endFocusSession,
  getActiveFocusSession,
  updateActiveFocusBlockers,
  updateActiveFocusStep,
} from "../character/focusSession";
import { startProductivityFocus } from "../character/productivitySession";
import {
  synthesizeDailyReview,
  synthesizeTestPlan,
  synthesizeWeeklyReview,
} from "../memory/reviewSynthesizer";
import { appendTimelineEvent } from "../memory/activityTimeline";
import type { AppSettings } from "../settings/appSettings";
import { defaultSettings } from "../settings/appSettings";
import {
  buildDailyReview,
  buildWeeklyReview,
  formatDailyReview,
  formatWeeklyReview,
} from "../memory/reviewAggregator";
import { buildCapabilitiesOverview } from "./capabilitiesOverview";
import { wrapCommandReply } from "./commandCharacterWrap";
import { tryHandleTaskChatCommandAsync } from "./taskChatParse";
import { ensureGoalForFocus, getCurrentGoal, updateGoal } from "../tasks/goalLedger";
import type { CharacterMood } from "../character/mood";
import {
  buildMoodRefusalReply,
  deriveMoodArchetype,
  moodRefusalKindForCommand,
  shouldMoodRefuseRequest,
} from "../character/moodBehavior";

export type ChatCommandResult = {
  handled: true;
  reply: string;
  command: string;
  emotion: import("../types/character").CharacterEmotion;
};

export type ChatCommandOutcome =
  | { handled: false }
  | ChatCommandResult;

function handled(command: string, body: string): ChatCommandResult {
  const wrapped = wrapCommandReply(command, body);
  appendTimelineEvent({
    kind: "chat_command",
    summary: command,
    payloadRef: wrapped.reply.slice(0, 120),
    projectId: getActiveProjectBinder()?.id,
  });
  return { handled: true, command, reply: wrapped.reply, emotion: wrapped.emotion };
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function tryHandleChatCommand(
  rawInput: string,
  settings?: AppSettings,
  mood?: CharacterMood,
): Promise<ChatCommandOutcome> {
  const input = rawInput.trim();
  const lower = normalize(input);
  if (!input) return { handled: false };

  if (
    /^(help|помощь)$/i.test(lower) ||
    /что ты умеешь/i.test(lower) ||
    /что ты можешь/i.test(lower) ||
    /твои возможности/i.test(lower) ||
    /на что ты способн/i.test(lower) ||
    /расскажи о возможностях/i.test(lower) ||
    /^что умеешь/i.test(lower)
  ) {
    return handled(
      "capabilities",
      buildCapabilitiesOverview(settings ?? defaultSettings),
    );
  }

  const taskResult = await tryHandleTaskChatCommandAsync(
    input,
    settings ?? defaultSettings,
    mood,
  );
  if (taskResult.handled) {
    return taskResult;
  }

  if (/^запомни это как текущий проект/i.test(input)) {
    const name =
      input.replace(/^запомни это как текущий проект/i, "").trim() ||
      "Текущий проект";
    const pathMatch = input.match(/[A-Za-z]:\\[^\n\r]+|\/[^\n\r]+/);
    if (!pathMatch) {
      return handled(
        "set-project",
        "Укажи абсолютный путь к папке проекта в той же фразе.",
      );
    }
    const project = upsertProjectBinder({
      name,
      rootPath: pathMatch[0].trim(),
    });
    return handled(
      "set-project",
      `Проект «${project.name}» привязан к ${project.rootPath}.`,
    );
  }

  if (/^прикрепи\s+readme/i.test(lower)) {
    const project = getActiveProjectBinder();
    if (!project) {
      return handled("attach-readme", "Сначала выбери активный проект.");
    }
    const candidates = ["README.md", "readme.md", "Readme.md"];
    for (const candidate of candidates) {
      try {
        const content = await readProjectFile(candidate, project);
        pinProjectFile(project.id, candidate);
        return handled(
          "attach-readme",
          `README прикреплён (${candidate}, ${content.length} символов).`,
        );
      } catch {
        // try next candidate
      }
    }
    return handled("attach-readme", "README не найден в корне проекта.");
  }

  if (/покажи последние изменённые файлы/i.test(lower)) {
    const files = await listRecentProjectFiles(null, 12);
    if (!files.length) {
      return handled("recent-files", "Нет доступных файлов в активном проекте.");
    }
    const lines = files.map(
      (file) =>
        `• ${file.relativePath} — ${formatBinderFileAge(file.modifiedAt)}`,
    );
    return handled("recent-files", ["Последние изменённые файлы:", ...lines].join("\n"));
  }

  if (/^фокус[:\s]+шаг/i.test(lower) || /^шаг фокуса/i.test(lower)) {
    const step = input.replace(/^фокус[:\s]+шаг\s*/i, "").replace(/^шаг фокуса[:\s]*/i, "").trim();
    if (!step) {
      return handled("focus-step", "Укажи текущий шаг после команды.");
    }
    const session = updateActiveFocusStep(step);
    const goal = getCurrentGoal();
    if (goal) {
      updateGoal(goal.id, { lastFocus: `Шаг: ${step}` });
    }
    return handled(
      "focus-step",
      session ? `Шаг фокуса: ${session.currentStep}` : "Нет активной фокус-сессии.",
    );
  }

  if (/^фокус[:\s]+задач/i.test(lower) || /^добавь задачу фокуса/i.test(lower)) {
    const title = input
      .replace(/^фокус[:\s]+задач[ауе]?\s*/i, "")
      .replace(/^добавь задачу фокуса[:\s]*/i, "")
      .trim();
    if (!title) {
      return handled("focus-task", "Какую задачу добавить?");
    }
    const task = addActiveFocusTask(title);
    return handled(
      "focus-task",
      task ? `Задача добавлена: ${task.title}` : "Нет активной фокус-сессии.",
    );
  }

  if (/^блокер[:\s]/i.test(lower) || /^фокус[:\s]+блокер/i.test(lower)) {
    const blocker = input
      .replace(/^блокер[:\s]*/i, "")
      .replace(/^фокус[:\s]+блокер[:\s]*/i, "")
      .trim();
    if (!blocker) {
      return handled("focus-blocker", "Что мешает?");
    }
    const session = addActiveFocusBlocker(blocker);
    return handled(
      "focus-blocker",
      session
        ? `Блокеры: ${(session.blockers ?? []).join("; ")}`
        : "Нет активной фокус-сессии.",
    );
  }

  if (/^блокеры фокуса[:\s]/i.test(lower)) {
    const raw = input.replace(/^блокеры фокуса[:\s]*/i, "").trim();
    const blockers = raw.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
    const session = updateActiveFocusBlockers(blockers);
    return handled(
      "focus-blockers",
      session
        ? `Блокеры обновлены: ${(session.blockers ?? []).join("; ") || "нет"}`
        : "Нет активной фокус-сессии.",
    );
  }

  if (/^старт фокуса/i.test(lower) || /^начни фокус/i.test(lower)) {
    if (
      mood &&
      shouldMoodRefuseRequest(mood, moodRefusalKindForCommand("focus-start"))
    ) {
      const archetype = deriveMoodArchetype(mood);
      const wrapped = wrapCommandReply(
        "mood-refusal",
        buildMoodRefusalReply(mood, moodRefusalKindForCommand("focus-start")),
      );
      return {
        handled: true,
        command: "mood-refusal",
        reply: wrapped.reply,
        emotion: archetype === "irritated" ? "annoyed" : "sleepy",
      };
    }
    const goal = input.replace(/^(старт фокуса|начни фокус)[:\s]*/i, "").trim();
    if (!goal) {
      return handled("focus-start", "Укажи цель фокуса в той же фразе.");
    }
    const linkedGoal = ensureGoalForFocus(goal);
    const session = startProductivityFocus({
      goal,
      plannedMinutes: settings?.pomodoroFocusMinutes ?? 25,
      breakMinutes: settings?.pomodoroBreakMinutes ?? 5,
    });
    return handled(
      "focus-start",
      `Фокус начат: ${session.goal}. Цель: «${linkedGoal.title}».`,
    );
  }

  if (/^(стоп|завершить|закончить) фокус/i.test(lower)) {
    const ended = endFocusSession("completed");
    return handled(
      "focus-stop",
      ended ? `Фокус завершён: ${ended.goal}` : "Активной фокус-сессии нет.",
    );
  }

  if (/сделай план тестирования для модуля/i.test(lower)) {
    const moduleName =
      input.replace(/.*модуля\s*/i, "").trim() || "модуля";
    const plan = settings
      ? await synthesizeTestPlan(settings, moduleName)
      : [
          `План тестирования для ${moduleName}:`,
          "1. Smoke: запуск и базовые сценарии.",
          "2. Unit: граничные случаи и ошибки ввода.",
          "3. Integration: связки с соседними модулями.",
          "4. Regression: проверка критичных путей.",
          "5. Manual: UI и read-only сценарии.",
        ].join("\n");
    addBacklogItem({
      title: `План тестирования: ${moduleName}`,
      notes: plan,
      category: "testing",
      priority: "normal",
      projectId: getActiveProjectBinder()?.id,
    });
    appendTimelineEvent({
      kind: "backlog",
      summary: `План тестирования: ${moduleName}`,
      projectId: getActiveProjectBinder()?.id,
    });
    return handled("test-plan", plan);
  }

  if (/сравни цель с todo/i.test(lower)) {
    const focus = getActiveFocusSession();
    const goal = focus?.goal?.trim() || "цель не задана";
    const todos =
      focus?.tasks
        ?.filter((task) => task.status !== "done")
        .map((task) => `• ${task.title}`)
        .join("\n") || "• задач нет";
    return handled(
      "goal-vs-todo",
      [`Цель: ${goal}`, "", "TODO:", todos].join("\n"),
    );
  }

  if (/^запиши в backlog/i.test(lower)) {
    const title = input.replace(/^запиши в backlog[:\s]*/i, "").trim();
    if (!title) {
      return handled("backlog-add", "Что записать в backlog?");
    }
    const item = addBacklogItem({
      title,
      projectId: getActiveProjectBinder()?.id,
    });
    appendTimelineEvent({
      kind: "backlog",
      summary: title,
      projectId: getActiveProjectBinder()?.id,
    });
    return handled("backlog-add", `Записала в дела: «${item.title}».`);
  }

  if (/^что next/i.test(lower) || /^что дальше/i.test(lower)) {
    const next = getNextBacklogItem();
    return handled(
      "backlog-next",
      next
        ? `Следующее: «${next.title}» [${next.category}, ${next.priority}]`
        : "Список дел пуст — можно добавить задачу.",
    );
  }

  if (/^по privacy/i.test(lower)) {
    const items = loadBacklogItems({ category: "privacy", status: "open" });
    if (!items.length) {
      return handled("backlog-privacy", "Открытых privacy-задач нет.");
    }
    const lines = items
      .slice(0, 10)
      .map((item) => `• ${item.title} (${item.priority})`);
    return handled("backlog-privacy", ["Privacy backlog:", ...lines].join("\n"));
  }

  if (/^отложи/i.test(lower)) {
    const title = input.replace(/^отложи[:\s]*/i, "").trim();
    const open = loadBacklogItems({ status: "open" });
    const match =
      open.find((item) => item.title.toLowerCase() === title.toLowerCase()) ??
      open[0];
    if (!match) {
      return handled("backlog-defer", "В backlog нет открытых задач.");
    }
    deferBacklogItem(match.id);
    return handled("backlog-defer", `Отложила: «${match.title}».`);
  }

  if (/git status|статус git|git summary/i.test(lower)) {
    assertGitReadOnlyIntent(input);
    const summary = await getGitSummaryForActiveProject();
    if (!summary) {
      return handled("git-status", "Активный проект не выбран.");
    }
    return handled("git-status", formatGitStatusSummary(summary));
  }

  if (/git log|последние коммиты/i.test(lower)) {
    assertGitReadOnlyIntent(input);
    const commits = await getRecentCommitsForActiveProject(8);
    return handled("git-log", formatRecentCommits(commits));
  }

  if (/^git diff/i.test(lower)) {
    assertGitReadOnlyIntent(input);
    const path = input.replace(/^git diff\s*/i, "").trim();
    const diff = await getDiffForActiveProject(path || undefined);
    return handled("git-diff", diff);
  }

  if (/daily review|дневной обзор/i.test(lower)) {
    const review = settings
      ? await synthesizeDailyReview(settings)
      : formatDailyReview(buildDailyReview());
    return handled("daily-review", review);
  }

  if (/weekly review|недельный обзор/i.test(lower)) {
    const review = settings
      ? await synthesizeWeeklyReview(settings)
      : formatWeeklyReview(buildWeeklyReview());
    return handled("weekly-review", review);
  }

  return { handled: false };
}
