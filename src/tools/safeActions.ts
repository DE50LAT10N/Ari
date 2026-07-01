import { invoke } from "@tauri-apps/api/core";
import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import { addUserMemoryFacts } from "../memory/userMemory";
import { addOpenLoops } from "../memory/episodicMemory";
import { addTask } from "../tasks/taskStore";
import { addGoal, findGoalByTitle, setCurrentGoal } from "../tasks/goalLedger";
import { parseTaskTitleAndDue } from "../chat/taskChatParse";
import { parsePomodoroStartRequest } from "../chat/productivityChat";
import type { StartFocusSessionInput } from "../character/focusSession";
import {
  classifyUserIntent,
  isHighConfidenceIntent,
} from "../character/userIntent";
import { indexDocument } from "../rag/ragClient";
import { addToAriInbox } from "../memory/ariInbox";
import { formatRuDateTime } from "../character/datetime";
import {
  getActiveProjectBinder,
  readProjectFile,
} from "../character/projectBinder";
import { parseEditorContext } from "../platform/windowContext";

export function actionText(action: SafeActionProposal): string | undefined {
  const text = (action.content ?? action.target)?.trim();
  return text || undefined;
}

export type SafeActionType =
  | "open_url"
  | "open_path"
  | "copy_text"
  | "create_note"
  | "create_reminder"
  | "create_task"
  | "create_goal"
  | "set_current_goal"
  | "start_pomodoro"
  | "stop_pomodoro"
  | "pause_pomodoro"
  | "resume_pomodoro"
  | "create_memory_fact"
  | "create_open_thread"
  | "add_file_to_rag"
  | "open_settings_page"
  | "export_note";

export type ProductivityActionHandlers = {
  startFocus?: (input: StartFocusSessionInput) => void;
  stopFocus?: () => void;
  pausePomodoro?: () => void;
  resumePomodoro?: () => void;
};

export type SafeActionProposal = {
  id: string;
  type: SafeActionType;
  title: string;
  target?: string;
  content?: string;
  filename?: string;
  dueAt?: number;
  status: "pending" | "running" | "approved" | "rejected" | "failed";
  result?: string;
};

type ExtractionResponse = {
  action?: unknown;
};

export type SafeActionExtractionContext = {
  activeWindow?: {
    processName?: string;
    title?: string;
  } | null;
  activeProjectRootPath?: string;
};

type NativeSafeAction = {
  actionType: "open_url" | "open_path" | "copy_text" | "create_note";
  target?: string;
  content?: string;
  filename?: string;
};

const ACTION_LOG_KEY = "desktop-character.safe-action-log.v1";

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/i;

export type SafeActionLogEntry = {
  timestamp: number;
  type: SafeActionType;
  title: string;
  status: "approved" | "rejected" | "failed";
  result: string;
};

function isActionType(value: unknown): value is SafeActionType {
  return (
    value === "open_url" ||
    value === "open_path" ||
    value === "copy_text" ||
    value === "create_note" ||
    value === "create_reminder" ||
    value === "create_task" ||
    value === "create_goal" ||
    value === "set_current_goal" ||
    value === "start_pomodoro" ||
    value === "stop_pomodoro" ||
    value === "pause_pomodoro" ||
    value === "resume_pomodoro" ||
    value === "create_memory_fact" ||
    value === "create_open_thread" ||
    value === "add_file_to_rag" ||
    value === "open_settings_page" ||
    value === "export_note"
  );
}

function createActionProposal(input: {
  type: SafeActionType;
  title: string;
  target?: string;
  content?: string;
  filename?: string;
  dueAt?: number;
}): SafeActionProposal {
  return {
    id:
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    title: input.title.slice(0, 160),
    target: input.target,
    content: input.content,
    filename: input.filename,
    dueAt: input.dueAt,
    status: "pending",
  };
}

function safeJoinWindowsPath(rootPath: string, relativePath: string): string | null {
  const root = rootPath.trim();
  const relative = relativePath.trim().replace(/\//g, "\\");
  if (!root || !relative || relative.includes("..") || WINDOWS_ABSOLUTE_PATH.test(relative)) {
    return null;
  }
  return `${root.replace(/[\\/]+$/, "")}\\${relative.replace(/^[\\/]+/, "")}`;
}

function resolveProjectRootPath(context?: SafeActionExtractionContext): string | undefined {
  return (
    context?.activeProjectRootPath?.trim() ||
    getActiveProjectBinder()?.rootPath?.trim() ||
    undefined
  );
}

function resolveOpenPathTarget(
  target: string | undefined,
  context?: SafeActionExtractionContext,
): string | undefined {
  const trimmed = target?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (WINDOWS_ABSOLUTE_PATH.test(trimmed) || trimmed.startsWith("\\\\")) {
    return trimmed;
  }
  const rootPath = resolveProjectRootPath(context);
  return rootPath ? safeJoinWindowsPath(rootPath, trimmed) ?? undefined : undefined;
}

function activeEditorFilePath(
  context?: SafeActionExtractionContext,
): { file?: string; target?: string } {
  const title = context?.activeWindow?.title;
  if (!title) {
    return {};
  }
  const editor = parseEditorContext(title);
  const file = editor.file?.trim();
  if (!file || !/\.[a-z0-9]{1,8}$/i.test(file)) {
    return {};
  }
  return {
    file,
    target: resolveOpenPathTarget(file, context) ?? file,
  };
}

function textRequestsOpen(text: string): boolean {
  return /(?:открой|открыть|покажи|показать|взглян|посмотр|прочитай|прочесть|open|show|read)/i.test(
    text,
  );
}

function replyPromisesConfirmation(reply: string): boolean {
  return /(?:карточк|подтвержд|разреш)/i.test(reply);
}

function extractContentAfterVerb(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  const value = match?.[1]?.trim();
  return value ? value.slice(0, 100_000) : undefined;
}

export function extractDeterministicSafeAction(
  userMessage: string,
  assistantReply = "",
  context?: SafeActionExtractionContext,
): SafeActionProposal | null {
  const combined = `${userMessage}\n${assistantReply}`;
  const url = combined.match(URL_PATTERN)?.[0];
  if (url && textRequestsOpen(combined)) {
    return createActionProposal({
      type: "open_url",
      title: "Открыть ссылку",
      target: url,
    });
  }

  const absolutePath = combined.match(/[A-Za-z]:[\\/][^\n\r"'<>|]+/)?.[0]?.trim();
  if (absolutePath && textRequestsOpen(combined)) {
    return createActionProposal({
      type: "open_path",
      title: "Открыть файл или папку",
      target: absolutePath,
    });
  }

  const copyText = extractContentAfterVerb(
    userMessage,
    /(?:скопируй|копируй|copy)\s+([\s\S]{2,})/i,
  );
  if (copyText) {
    return createActionProposal({
      type: "copy_text",
      title: "Скопировать текст",
      content: copyText,
    });
  }

  const shouldOpenActiveFile =
    textRequestsOpen(userMessage) ||
    (replyPromisesConfirmation(assistantReply) && textRequestsOpen(assistantReply));
  if (shouldOpenActiveFile) {
    const activeFile = activeEditorFilePath(context);
    if (activeFile.target) {
      return createActionProposal({
        type: "open_path",
        title: `Открыть ${activeFile.file ?? "активный файл"}`,
        target: activeFile.target,
      });
    }
  }

  return null;
}

export function isSafeActionProposal(
  value: unknown,
): value is SafeActionProposal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SafeActionProposal>;
  return (
    typeof candidate.id === "string" &&
    isActionType(candidate.type) &&
    typeof candidate.title === "string" &&
    (candidate.status === "pending" ||
      candidate.status === "running" ||
      candidate.status === "approved" ||
      candidate.status === "rejected" ||
      candidate.status === "failed")
  );
}

export function describeSafeActionDetail(action: SafeActionProposal): string {
  switch (action.type) {
    case "open_url":
    case "open_path":
      return action.target ?? "";
    case "copy_text":
      return `Скопировать: ${action.content?.slice(0, 120) ?? ""}`;
    case "create_task":
      return `Задача: ${action.content?.slice(0, 120) ?? action.target ?? ""}`;
    case "create_goal":
      return `Цель: ${action.content?.slice(0, 120) ?? action.target ?? ""}`;
    case "set_current_goal":
      return `Текущая цель: ${action.content?.slice(0, 120) ?? action.target ?? ""}`;
    case "start_pomodoro":
      return `Помодоро: ${action.content?.slice(0, 120) ?? action.target ?? "фокус"}`;
    case "stop_pomodoro":
      return "Остановить помодоро и фокус";
    case "pause_pomodoro":
      return "Пауза помодоро";
    case "resume_pomodoro":
      return "Продолжить помодоро";
    case "create_memory_fact":
      return `Запомнить: ${action.content?.slice(0, 120) ?? ""}`;
    case "create_reminder":
      return `Напоминание: ${action.content?.slice(0, 120) ?? ""}`;
    case "create_open_thread":
      return `Ветка: ${action.content?.slice(0, 120) ?? ""}`;
    case "add_file_to_rag":
      return action.target ?? action.content?.slice(0, 100) ?? "файл в RAG";
    case "open_settings_page":
      return "Открыть настройки";
    default:
      return (
        action.filename ||
        action.content?.slice(0, 100) ||
        action.target ||
        action.title
      );
  }
}

export async function extractSafeAction(
  userMessage: string,
  assistantReply: string,
  settings: AppSettings,
  context?: SafeActionExtractionContext,
): Promise<SafeActionProposal | null> {
  if (!settings.safeActionsEnabled) return null;

  const intent = settings.intentClassifierEnabled
    ? classifyUserIntent(userMessage)
    : null;
  const deterministic = extractDeterministicSafeAction(
    userMessage,
    assistantReply,
    context,
  );
  if (deterministic) {
    return deterministic;
  }

  if (
    intent &&
    isHighConfidenceIntent(intent, 0.85) &&
    intent.intent !== "request_action" &&
    intent.intent !== "task_command"
  ) {
    return null;
  }

  if (
    !/(открой|открыть|запусти|скопируй|копировать|создай|запиши|напомни|задач|дела|цель|помодоро|фокус|таймер|память|запомни|привычк|предпочита|ветк|rag|журнал|настройк|open |copy |clipboard|create|remind|memory|thread|journal|settings|task|goal|pomodoro|https?:\/\/|[a-zа-я]:\\)/i.test(
      userMessage,
    )
  ) {
    return null;
  }

  const response = await completeLlmJson<ExtractionResponse>(
    [
      {
        role: "system",
        content: [
          "Определи, явно ли пользователь попросил выполнить одно безопасное действие (или Ari в ответе согласилась это сделать после просьбы).",
          "Допустимы: open_url, open_path, copy_text, create_note, create_reminder, create_task, create_goal, set_current_goal, start_pomodoro, stop_pomodoro, pause_pomodoro, resume_pomodoro, create_memory_fact, create_open_thread, add_file_to_rag, open_settings_page, export_note.",
          "create_goal — новая долгосрочная цель; set_current_goal — переключить текущую цель.",
          "start_pomodoro — запуск таймера фокуса; в content укажи цель/тему и при необходимости «25 мин».",
          "create_memory_fact — устойчивый факт о пользователе (привычка, предпочтение, особенность).",
          "Не предлагай действие по собственной инициативе без явной просьбы в диалоге.",
          'Верни {"action":null}, если явной просьбы нет.',
          'Иначе верни {"action":{"type":"...","title":"...","target":"...","content":"...","filename":"...","dueAt":"ISO8601"}}.',
        ].join("\n"),
      },
      {
        role: "user",
        content: `Сообщение пользователя:\n${userMessage}\n\nОтвет Ari:\n${assistantReply}`,
      },
    ] satisfies ChatMessage[],
    settings,
    260,
    "validator",
  );

  const raw = response.action;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (!isActionType(candidate.type)) return null;

  const rawTarget =
    typeof candidate.target === "string" ? candidate.target.trim() : undefined;
  const target =
    candidate.type === "open_path"
      ? resolveOpenPathTarget(rawTarget, context) ?? rawTarget
      : rawTarget;
  const content =
    typeof candidate.content === "string"
      ? candidate.content.slice(0, 100_000)
      : undefined;
  const filename =
    typeof candidate.filename === "string"
      ? candidate.filename.trim().slice(0, 120)
      : undefined;
  const dueAt =
    typeof candidate.dueAt === "string"
      ? Date.parse(candidate.dueAt)
      : typeof candidate.dueAt === "number"
        ? candidate.dueAt
        : undefined;

  if (
    (candidate.type === "open_url" || candidate.type === "open_path") &&
    !target
  ) {
    return null;
  }
  if (
    (candidate.type === "copy_text" ||
      candidate.type === "create_note" ||
      candidate.type === "export_note" ||
      candidate.type === "create_memory_fact" ||
      candidate.type === "create_open_thread" ||
      candidate.type === "create_reminder" ||
      candidate.type === "create_task" ||
      candidate.type === "create_goal" ||
      candidate.type === "set_current_goal" ||
      candidate.type === "start_pomodoro" ||
      candidate.type === "add_file_to_rag") &&
    !content &&
    !target
  ) {
    return null;
  }

  return createActionProposal({
    type: candidate.type,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim().slice(0, 160)
        : "Выполнить предложенное действие",
    target,
    content,
    filename,
    dueAt: Number.isFinite(dueAt) ? dueAt : undefined,
  });
}

export async function executeSafeAction(
  action: SafeActionProposal,
  settings: AppSettings,
  handlers?: ProductivityActionHandlers,
): Promise<string> {
  const text = actionText(action);

  if (action.type === "create_goal") {
    if (!text) {
      throw new Error("Укажи название цели.");
    }
    const goal = addGoal({
      title: text.slice(0, 200),
      current: true,
      notes: "Создано из диалога с подтверждением.",
    });
    const result = `Цель «${goal.title}» добавлена и взята в фокус.`;
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "set_current_goal") {
    if (!text) {
      throw new Error("Укажи цель для фокуса.");
    }
    const goal = findGoalByTitle(text);
    if (!goal || goal.status !== "active") {
      throw new Error(`Не нашла активную цель «${text}».`);
    }
    setCurrentGoal(goal.id);
    const result = `Текущая цель: «${goal.title}».`;
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "start_pomodoro") {
    if (!settings.pomodoroEnabled) {
      throw new Error("Помодоро выключено в настройках.");
    }
    if (!handlers?.startFocus) {
      throw new Error("Запуск помодоро недоступен в этом контексте.");
    }
    const { goal, minutes } = parsePomodoroStartRequest(
      text ?? action.title,
      settings.pomodoroFocusMinutes,
    );
    handlers.startFocus({
      goal,
      plannedMinutes: minutes,
      breakMinutes: settings.pomodoroBreakMinutes,
    });
    const result = `Помодоро запущен: ${minutes} мин, «${goal}».`;
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "stop_pomodoro") {
    handlers?.stopFocus?.();
    const result = "Помодоро и фокус остановлены.";
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "pause_pomodoro") {
    handlers?.pausePomodoro?.();
    const result = "Помодоро на паузе.";
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "resume_pomodoro") {
    handlers?.resumePomodoro?.();
    const result = "Помодоро продолжен.";
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "create_memory_fact") {
    if (!text) {
      throw new Error("Укажи текст факта для памяти.");
    }
    const result = await addUserMemoryFacts([text], "manual");
    const message = result.changed
      ? "Факт добавлен в долговременную память."
      : "Такой факт уже есть в памяти — ничего не изменилось.";
    appendActionLog(action, "approved", message);
    return message;
  }

  if (action.type === "create_open_thread") {
    if (!text) {
      throw new Error("Укажи текст открытой ветки.");
    }
    if (text.length < 6) {
      const message = "Текст ветки слишком короткий (минимум 6 символов).";
      appendActionLog(action, "failed", message);
      return message;
    }
    await addOpenLoops([{ text, dueAt: action.dueAt }]);
    const result = "Открытая ветка создана.";
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "create_task") {
    if (!text) {
      throw new Error("Укажи текст задачи.");
    }
    const { title, dueAt } = parseTaskTitleAndDue(text);
    const task = addTask({
      title: title || text.slice(0, 120),
      notes: text,
      kind: dueAt ? "reminder" : "task",
      status: "open",
      priority: "normal",
      dueAt,
      source: "safe_action",
    });
    const result = dueAt
      ? `Задача «${task.title}» добавлена. Срок: ${formatRuDateTime(dueAt)}.`
      : `Задача «${task.title}» добавлена в дела.`;
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "create_reminder") {
    if (!text) {
      throw new Error("Укажи текст напоминания.");
    }
    const dueAt = action.dueAt ?? Date.now() + 24 * 60 * 60 * 1000;
    await addOpenLoops([{ text, dueAt }]);
    const result = `Напоминание запланировано на ${formatRuDateTime(dueAt)}.`;
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "add_file_to_rag") {
    let content = action.content?.trim();
    const sourceName = action.target ?? action.filename ?? "imported.txt";
    if (!content) {
      const path = action.target?.trim();
      if (!path) {
        throw new Error(
          "Укажи текст для индексации или путь к файлу в активном проекте.",
        );
      }
      const project = getActiveProjectBinder();
      if (!project) {
        throw new Error(
          "Активный проект не выбран — укажи текст напрямую или привяжи проект.",
        );
      }
      content = await readProjectFile(path, project);
    }
    const chunks = await indexDocument(sourceName, content, settings);
    const result = `Добавлено ${chunks} фрагментов в RAG.`;
    appendActionLog(action, "approved", result);
    return result;
  }

  if (action.type === "open_settings_page") {
    window.dispatchEvent(new Event("ari-open-settings"));
    const result = "Открыты настройки Ari.";
    appendActionLog(action, "approved", result);
    return result;
  }

  let nativeType: NativeSafeAction["actionType"];
  if (action.type === "export_note") {
    nativeType = "create_note";
  } else if (
    action.type === "open_url" ||
    action.type === "open_path" ||
    action.type === "copy_text" ||
    action.type === "create_note"
  ) {
    nativeType = action.type;
  } else {
    throw new Error(`Неподдерживаемый тип действия: ${action.type}`);
  }

  const nativeAction: NativeSafeAction = {
    actionType: nativeType,
    target:
      nativeType === "open_path"
        ? resolveOpenPathTarget(action.target) ??
          (() => {
            throw new Error(
              "Для открытия файла нужен абсолютный путь или активный привязанный проект.",
            );
          })()
        : action.target,
    content:
      nativeType === "copy_text" || nativeType === "create_note"
        ? (action.content ?? action.target)
        : action.content,
    filename: action.filename,
  };

  const result = await invoke<string>("perform_safe_action", {
    action: {
      actionType: nativeAction.actionType,
      target: nativeAction.target,
      content: nativeAction.content,
      filename: nativeAction.filename,
    } satisfies NativeSafeAction,
  });
  appendActionLog(action, "approved", result);
  return result;
}

export function logRejectedAction(action: SafeActionProposal): void {
  appendActionLog(action, "rejected", "Отклонено пользователем");
}

export function logFailedAction(
  action: SafeActionProposal,
  result: string,
): void {
  appendActionLog(action, "failed", result);
  addToAriInbox({
    kind: "failed_action",
    title: action.title,
    body: `${action.type}: ${result}`,
    confidence: 1,
    reason: "Safe action failed or blocked",
    metadata: { actionId: action.id, actionType: action.type },
  });
}

function appendActionLog(
  action: SafeActionProposal,
  status: "approved" | "rejected" | "failed",
  result: string,
): void {
  try {
    const current = JSON.parse(
      localStorage.getItem(ACTION_LOG_KEY) ?? "[]",
    ) as unknown[];
    localStorage.setItem(
      ACTION_LOG_KEY,
      JSON.stringify(
        [
          {
            timestamp: Date.now(),
            type: action.type,
            title: action.title,
            status,
            result: result.slice(0, 500),
          },
          ...(Array.isArray(current) ? current : []),
        ].slice(0, 100),
      ),
    );
    window.dispatchEvent(new Event("ari-safe-action-log-changed"));
  } catch {
    // Logging must never block the confirmed action.
  }
}

export function loadSafeActionLog(): SafeActionLogEntry[] {
  try {
    const stored = JSON.parse(
      localStorage.getItem(ACTION_LOG_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(stored)
      ? stored.filter(
          (value): value is SafeActionLogEntry =>
            Boolean(value) &&
            typeof value === "object" &&
            typeof (value as SafeActionLogEntry).timestamp === "number" &&
            typeof (value as SafeActionLogEntry).title === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function clearSafeActionLog(): void {
  localStorage.removeItem(ACTION_LOG_KEY);
  window.dispatchEvent(new Event("ari-safe-action-log-changed"));
}
