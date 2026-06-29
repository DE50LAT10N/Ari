import type { AppSettings } from "../settings/appSettings";
import { buildAdvisorContext, describeAdvisorFlags, type AdvisorContext } from "./advisorContext";
import {
  buildAdvisorAngleIntent,
  isInitiativeTopicAllowed,
  pickPlannedInitiativeAnchor,
  type AdvisorAngle,
} from "./advisorEngine";
import { PRACTICAL_INITIATIVE_RULE } from "./advisorEngine";
import { describePinnedProjectContext } from "./projectBinder";
import { getActiveFocusSession } from "./focusSession";
import { buildDailyReview } from "../memory/reviewAggregator";
import { getActivitySignals } from "../memory/activitySignals";
import { pruneWorkingMemory } from "../memory/workingMemory";
import { getNextTask } from "../tasks/taskStore";
import { formatRuDateTime } from "./datetime";
import { describeRoutineContext } from "./routines";
import type { InitiativeKind } from "./initiativeKinds";
import { describeProactiveLiveliness, VN_CHARACTER_RULE } from "./proactiveLiveliness";
import { describeMoodForPrompt, loadMood } from "./mood";
import {
  getProactiveCooldownSubjects,
  getRecentProactiveTopics,
} from "./proactiveState";

const VISION_OBS_KEY = "desktop-character.last-vision-observation.v1";
const CLIPBOARD_SIGNAL_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const VISION_SIGNAL_MAX_AGE_MS = 30 * 60 * 1000;

export type ProactiveInitiativePackage = {
  eventDescription: string;
  initiativeKind: InitiativeKind;
  initiativeAnchor?: string;
  softInitiativeAnchor?: boolean;
  bannedProactiveTopics: string[];
  plannedCheckFreshTopics?: boolean;
  skipLlmGate?: boolean;
};

export type MemorySnippet = {
  text: string;
  kind: "fact" | "episode" | "loop";
  summaryHint?: string;
};

export type ProactivePackageOptions = {
  sessionMinutes?: number;
  windowMinutes?: number;
  processName?: string;
  windowTitle?: string;
  visionObservation?: { text: string; timestamp: number } | null;
  now?: number;
  advisorAngle?: AdvisorAngle;
  conversationTopics?: string[];
  taskTitle?: string;
  taskNotes?: string;
  memorySnippet?: MemorySnippet;
  eventHint?: string;
  eventLabel?: string;
  distractionPlace?: string;
};

export type ClipboardSnippet = {
  kind: "code" | "stacktrace" | "url" | "text";
  text: string;
  at: number;
};

export type InitiativeSignalBundle = {
  advisor: AdvisorContext;
  hasActionableSignals: boolean;
  window?: { processName: string; title: string };
  editorFile?: string;
  editorRepo?: string;
  projectContext: string;
  clipboardSnippets: ClipboardSnippet[];
  visionSummary?: string;
  focusGoal?: string;
  focusStep?: string;
  focusBlockers: string[];
  taskActivityLink?: AdvisorContext["taskActivityLink"];
  nextTaskTitle?: string;
  recentCompletion?: string;
  dailyNextStep?: string;
  dailyStuck: string[];
  advisorFlags: string;
  moodPrompt: string;
};

export function loadPersistedVisionObservation(): {
  text: string;
  timestamp: number;
} | null {
  try {
    const raw = JSON.parse(localStorage.getItem(VISION_OBS_KEY) ?? "null") as {
      text?: string;
      timestamp?: number;
    } | null;
    if (!raw?.text || typeof raw.timestamp !== "number") {
      return null;
    }
    return { text: raw.text, timestamp: raw.timestamp };
  } catch {
    return null;
  }
}

function collectClipboardSnippets(now: number): ClipboardSnippet[] {
  return getActivitySignals(20)
    .filter((entry) => entry.kind === "clipboard")
    .filter((entry) => now - entry.at <= CLIPBOARD_SIGNAL_MAX_AGE_MS)
    .slice(-4)
    .map((entry) => ({
      kind: entry.clipKind,
      text: entry.snippet.slice(0, 120),
      at: entry.at,
    }));
}

function collectVisionSummary(
  settings: AppSettings,
  options: { visionObservation?: { text: string; timestamp: number } | null },
  now: number,
): string | undefined {
  const persisted =
    options.visionObservation ?? loadPersistedVisionObservation();
  if (
    persisted &&
    settings.visualMemoryMinutes > 0 &&
    now - persisted.timestamp <= settings.visualMemoryMinutes * 60_000
  ) {
    return persisted.text.slice(0, 280);
  }

  const glance = [...pruneWorkingMemory(now)]
    .reverse()
    .find((entry) => entry.kind === "screen_glance");
  if (glance && now - glance.at <= VISION_SIGNAL_MAX_AGE_MS) {
    return glance.topic.slice(0, 280);
  }

  return undefined;
}

export function buildInitiativeSignalBundle(
  settings: AppSettings,
  options: {
    sessionMinutes?: number;
    windowMinutes?: number;
    processName?: string;
    windowTitle?: string;
    visionObservation?: { text: string; timestamp: number } | null;
    now?: number;
  } = {},
): InitiativeSignalBundle {
  const now = options.now ?? Date.now();
  const advisor = buildAdvisorContext(settings, {
    now,
    sessionMinutes: options.sessionMinutes,
    windowMinutes: options.windowMinutes,
    processName: options.processName,
    windowTitle: options.windowTitle,
  });
  const focus = getActiveFocusSession();
  const review = buildDailyReview(new Date(now));
  const nextTask = getNextTask();
  const clipboardSnippets = collectClipboardSnippets(now);
  const visionSummary = collectVisionSummary(settings, options, now);
  const projectContext = describePinnedProjectContext();
  const editorFile = advisor.dominantFile ?? advisor.editorContext.file;
  const editorRepo = advisor.dominantRepo ?? advisor.editorContext.repo;

  const hasActionableSignals = Boolean(
    editorFile ||
      clipboardSnippets.length ||
      visionSummary ||
      focus?.blockers?.length ||
      focus?.currentStep ||
      advisor.taskActivityLink ||
      nextTask?.title ||
      advisor.recentCompletions[0] ||
      (review.nextStep && !/не выбран/i.test(review.nextStep)) ||
      projectContext ||
      advisor.stuckScore >= 0.45 ||
      advisor.breakDue,
  );

  return {
    advisor,
    hasActionableSignals,
    window:
      options.processName && options.windowTitle
        ? { processName: options.processName, title: options.windowTitle }
        : undefined,
    editorFile,
    editorRepo,
    projectContext,
    clipboardSnippets,
    visionSummary,
    focusGoal: focus?.goal,
    focusStep: focus?.currentStep,
    focusBlockers: focus?.blockers?.slice(0, 3) ?? [],
    taskActivityLink: advisor.taskActivityLink,
    nextTaskTitle: nextTask?.title,
    recentCompletion: advisor.recentCompletions[0],
    dailyNextStep: review.nextStep,
    dailyStuck: review.stuck.slice(0, 2),
    advisorFlags: describeAdvisorFlags(advisor),
    moodPrompt: describeMoodForPrompt(loadMood()),
  };
}

function adviceTypeForAnchor(anchor?: string): string {
  if (!anchor) {
    return "тип совета: общий практический шаг по текущему контексту";
  }
  if (/ошибк|отлад|stack|буфер/i.test(anchor)) {
    return "тип совета: debug — один конкретный шаг проверки или команда";
  }
  if (/промпт|буфер|код|фрагмент/i.test(anchor)) {
    return "тип совета: prompt-example — готовый пример промпта или команды в кавычках";
  }
  if (/перерыв|отдох/i.test(anchor)) {
    return "тип совета: rest — короткий перерыв без нравоучений";
  }
  if (/как идёт|файл|проект/i.test(anchor)) {
    return "тип совета: next-step — один следующий шаг по файлу или задаче";
  }
  return "тип совета: next-step — конкретная польза, не общий вопрос";
}

export function formatInitiativeContextForPrompt(
  bundle: InitiativeSignalBundle,
): string {
  const lines: string[] = [];

  if (bundle.window) {
    lines.push(
      `Активное окно: ${bundle.window.processName} — ${bundle.window.title}`,
    );
  }
  if (bundle.editorFile) {
    lines.push(
      `Файл в IDE: ${bundle.editorFile}${bundle.editorRepo ? ` (${bundle.editorRepo})` : ""}`,
    );
  }
  if (bundle.projectContext) {
    lines.push(bundle.projectContext);
  }
  for (const clip of bundle.clipboardSnippets.slice(-2)) {
    lines.push(`Буфер (${clip.kind}): ${clip.text}`);
  }
  if (bundle.visionSummary) {
    lines.push(`Последний взгляд на экран: ${bundle.visionSummary}`);
  }
  if (bundle.focusGoal) {
    lines.push(`Фокус-сессия: ${bundle.focusGoal}`);
  }
  if (bundle.focusStep) {
    lines.push(`Текущий шаг: ${bundle.focusStep}`);
  }
  if (bundle.focusBlockers.length) {
    lines.push(`Блокеры: ${bundle.focusBlockers.join("; ")}`);
  }
  if (bundle.taskActivityLink?.taskTitle) {
    const goal = bundle.taskActivityLink.goalTitle
      ? ` (цель: ${bundle.taskActivityLink.goalTitle})`
      : "";
    lines.push(
      bundle.taskActivityLink.shouldAsk
        ? `Уточнить связь активности с задачей: ${bundle.taskActivityLink.reason}${goal}`
        : `Активность похожа на задачу: ${bundle.taskActivityLink.taskTitle}${goal}`,
    );
  }
  if (bundle.nextTaskTitle) {
    lines.push(`Открытая задача: ${bundle.nextTaskTitle}`);
  }
  if (bundle.recentCompletion) {
    lines.push(`Недавно закрыто: ${bundle.recentCompletion}`);
  }
  if (bundle.dailyNextStep && !/не выбран/i.test(bundle.dailyNextStep)) {
    lines.push(`Следующий шаг дня: ${bundle.dailyNextStep}`);
  }
  if (bundle.dailyStuck.length) {
    lines.push(`Застряло: ${bundle.dailyStuck.join("; ")}`);
  }
  if (bundle.advisorFlags !== "none") {
    lines.push(`Сигналы советника: ${bundle.advisorFlags}`);
  }

  return lines.join("\n").slice(0, 1500);
}

function buildKindIntent(
  kind: InitiativeKind,
  bundle: InitiativeSignalBundle,
  options: ProactivePackageOptions,
): string {
  if (options.eventHint?.trim()) {
    return options.eventHint.trim();
  }

  switch (kind) {
    case "check_in":
      return "Плановая проверка инициативы после периода тишины.";
    case "process_advice":
    case "break_suggestion":
      if (options.advisorAngle) {
        return buildAdvisorAngleIntent(bundle.advisor, options.advisorAngle);
      }
      if (kind === "break_suggestion") {
        const mins = Math.max(
          bundle.advisor.sessionMinutes,
          bundle.advisor.windowMinutes,
        );
        return [
          "Судя по активности, человек давно в одном ритме — мягко предложи короткий перерыв.",
          `Сессия около ${mins} мин.`,
          "Одно короткое сообщение от Ari, без нравоучений.",
        ].join("\n");
      }
      return "Мягкий совет по текущему рабочему процессу — один конкретный шаг.";
    case "unfinished_thread":
      return [
        "Мягко напомни о незавершённом деле без давления.",
        options.taskTitle ? `Задача: «${options.taskTitle}».` : "",
        options.taskNotes ? `Контекст: ${options.taskNotes.slice(0, 160)}.` : "",
      ]
        .filter(Boolean)
        .join("\n");
    case "memory_callback": {
      const snippet = options.memorySnippet;
      if (!snippet) {
        return "Редкая естественная отсылка к релевантному эпизоду или факту.";
      }
      const body =
        snippet.kind === "fact"
          ? `Уместный факт: «${snippet.text}». Сформулируй как «помнишь, ты говорил…» или похожую живую отсылку.`
          : snippet.kind === "loop"
            ? `Открытый хвост: «${snippet.text}». Можно мягко спросить, не хочет ли вернуться к этому.`
            : `Уместный эпизод: ${snippet.text}. Верни к нему естественно, без перечисления дат.`;
      return [
        "Редкая естественная отсылка к релевантному эпизоду или факту.",
        body,
        snippet.summaryHint,
        "Не упоминай базу данных, индексацию или систему памяти.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "distraction_nudge":
      return [
        "Человек отвлёкся во время фокус-сессии помодоро.",
        options.distractionPlace
          ? `Сейчас в окне: ${options.distractionPlace.slice(0, 120)}.`
          : "",
        "Мягко напомни вернуться к делу — одно короткое сообщение, без нравоучений и без давления.",
        "Не говори, что следишь за экраном. Звучи как Ari, которая рядом.",
      ]
        .filter(Boolean)
        .join("\n");
    case "return_reaction":
      return "Вернулся после паузы — естественно отметь возвращение, без формального приветствия.";
    case "context_comment":
      return [
        options.eventLabel
          ? `Событие: ${options.eventLabel}.`
          : "Короткая реакция на событие рабочего стола.",
        "Реагируй коротко и естественно, без преувеличения объёма доступных данных.",
      ]
        .filter(Boolean)
        .join("\n");
    case "screen_glance":
      return "Одноразовый взгляд на разрешённый снимок экрана — короткая живая реакция.";
    default:
      return "Мягкая проактивная реплика по текущему контексту.";
  }
}

export function resolveInitiativeAnchor(
  kind: InitiativeKind,
  bundle: InitiativeSignalBundle,
  options: ProactivePackageOptions,
  banned: string[],
): string | undefined {
  switch (kind) {
    case "check_in":
    case "process_advice":
      return pickPlannedInitiativeAnchor(options.conversationTopics ?? [], {
        recentProactive: banned,
        windowTitle: options.windowTitle,
        dominantFile: bundle.editorFile,
      });
    case "break_suggestion": {
      const mins = Math.max(
        bundle.advisor.sessionMinutes,
        bundle.advisor.windowMinutes,
      );
      const anchor = `короткий перерыв после ${mins} мин`;
      return isInitiativeTopicAllowed(anchor, banned) ? anchor : undefined;
    }
    case "unfinished_thread":
      if (options.taskTitle) {
        const anchor = `незавершённое: ${options.taskTitle}`;
        return isInitiativeTopicAllowed(anchor, banned)
          ? options.taskTitle
          : undefined;
      }
      return undefined;
    case "memory_callback":
      if (options.memorySnippet?.text) {
        return options.memorySnippet.text.slice(0, 120);
      }
      return undefined;
    case "distraction_nudge":
      if (bundle.focusGoal) {
        const anchor = bundle.focusGoal.slice(0, 120);
        return isInitiativeTopicAllowed(anchor, banned) ? anchor : undefined;
      }
      return undefined;
    case "context_comment":
      return options.eventLabel?.slice(0, 120);
    default:
      return undefined;
  }
}

export function buildProactiveInitiativeContext(input: {
  kind: InitiativeKind;
  bundle: InitiativeSignalBundle;
  banned: string[];
  anchor?: string;
  conversationTopics?: string[];
  options?: ProactivePackageOptions;
}): string {
  const { kind, bundle, banned, anchor, conversationTopics = [] } = input;
  const options = input.options ?? {};
  const signalBlock = formatInitiativeContextForPrompt(bundle);
  const kindIntent = buildKindIntent(kind, bundle, options);
  const liveliness = describeProactiveLiveliness(kind);
  const adviceHeavy =
    kind === "process_advice" ||
    kind === "distraction_nudge" ||
    kind === "break_suggestion";

  const shared = [
    liveliness,
    VN_CHARACTER_RULE,
    bundle.moodPrompt ? `Настроение Ari сейчас: ${bundle.moodPrompt}` : "",
    kindIntent,
    `Текущее время: ${formatRuDateTime(bundle.advisor.now)}`,
    `Привычный ритм: ${describeRoutineContext(new Date(bundle.advisor.now))}.`,
    adviceHeavy ? PRACTICAL_INITIATIVE_RULE : "",
    adviceTypeForAnchor(anchor),
    signalBlock ? `Доступные сигналы:\n${signalBlock}` : "",
    `Недавние темы инициативы, которые нельзя повторять: ${
      banned.join(" | ") || "нет"
    }.`,
  ];

  if (kind === "check_in") {
    return [
      ...shared,
      conversationTopics.length
        ? `Возможные темы (выбери одну, не из запретов): ${conversationTopics.join(" | ")}.`
        : bundle.hasActionableSignals
          ? "Выбери тему из доступных сигналов выше — не повторяй недавние инициативы."
          : "Свежих тем нет — дай короткую нейтральную реплику без привязки к старой вкладке.",
      `Доступны свежие темы: ${conversationTopics.length > 0 || bundle.hasActionableSignals ? "да" : "нет"}.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return shared.filter(Boolean).join("\n");
}

export function collectBannedProactiveTopics(): string[] {
  return [
    ...getRecentProactiveTopics(),
    ...getProactiveCooldownSubjects(),
  ];
}

export function buildProactiveInitiativePackage(
  settings: AppSettings,
  kind: InitiativeKind,
  options: ProactivePackageOptions = {},
): ProactiveInitiativePackage {
  const bundle = buildInitiativeSignalBundle(settings, options);
  const banned = collectBannedProactiveTopics();
  const anchor = resolveInitiativeAnchor(kind, bundle, options, banned);
  const conversationTopics = options.conversationTopics ?? [];
  const eventDescription = buildProactiveInitiativeContext({
    kind,
    bundle,
    banned,
    anchor,
    conversationTopics,
    options,
  });

  const plannedCheckFreshTopics =
    kind === "check_in"
      ? conversationTopics.length > 0 || bundle.hasActionableSignals
      : undefined;

  return {
    eventDescription,
    initiativeKind: kind,
    initiativeAnchor: anchor,
    softInitiativeAnchor: true,
    bannedProactiveTopics: banned,
    plannedCheckFreshTopics,
    skipLlmGate: kind === "check_in" ? true : undefined,
  };
}
