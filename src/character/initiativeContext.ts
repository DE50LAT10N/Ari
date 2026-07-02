import type { AppSettings } from "../settings/appSettings";
import { buildAdvisorContext, describeAdvisorFlags, type AdvisorContext } from "./advisorContext";
import {
  buildAdvisorAngleIntent,
  buildFallbackInitiativeTopics,
  hasActionableAdvisorSignals,
  hasUsableProactiveContext,
  isInitiativeTopicAllowed,
  pickPlannedInitiativeAnchor,
  PRACTICAL_INITIATIVE_RULE,
  type AdvisorAngle,
} from "./advisorEngine";
import { describePinnedProjectContext } from "./projectBinder";
import { getActiveFocusSession } from "./focusSession";
import { buildDailyReview } from "../memory/reviewAggregator";
import { getActivitySignals } from "../memory/activitySignals";
import { pruneWorkingMemory } from "../memory/workingMemory";
import { getNextTask } from "../tasks/taskStore";
import { formatRuDateTime } from "./datetime";
import { describeRoutineContext } from "./routines";
import type { AdviceUrgency } from "./adviceUrgency";
import {
  buildAdviceBrief,
  buildProactiveSignalSummary,
  buildRichProactiveContext,
  buildSmalltalkAngles,
} from "./proactiveContextRich";
import type { InitiativeKind } from "./initiativeKinds";
import { describeProactiveLiveliness, VN_CHARACTER_RULE, describeProactiveTone, PROACTIVE_SMALLTALK_RULE } from "./proactiveLiveliness";
import { isPracticalAnchor, resolveProactiveReplyTone, type ProactiveReplyTone } from "./proactiveTone";
import { describeMoodForPrompt, loadMood } from "./mood";
import {
  buildAdviceTopicKey,
  describeAdviceMemoryForPrompt,
} from "./adviceLedger";
import { describeAdviceOutcomesForPrompt } from "./adviceOutcome";
import {
  getProactiveCooldownSubjects,
  getRecentProactiveTopics,
} from "./proactiveState";
import type { ProactiveLlmBundle } from "./proactiveLlmEngine";
import { buildProactiveSummaryFromBundle } from "./proactiveLlmEngine";

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
  proactiveReplyTone?: ProactiveReplyTone;
  advisorAngle?: AdvisorAngle;
  proactiveSignalSummary?: string;
  llmBundle?: ProactiveLlmBundle;
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
  companionSilenceMs?: number;
  codingSessionMinutes?: number;
  recentUserMessage?: string;
  urgency?: AdviceUrgency;
  recentChatTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  llmBundle?: ProactiveLlmBundle;
};

export type ClipboardSnippet = {
  kind: "code" | "stacktrace" | "diagnostic" | "url" | "text";
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

export function loadPersistedVisionObservation(
  maxAgeMs = 24 * 60 * 60_000,
  now = Date.now(),
): {
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
    if (now - raw.timestamp > maxAgeMs) {
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
      text: entry.snippet.slice(0, 220),
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
      (options.processName && options.windowTitle) ||
      clipboardSnippets.length ||
      visionSummary ||
      focus?.goal ||
      focus?.blockers?.length ||
      focus?.currentStep ||
      advisor.taskActivityLink ||
      nextTask?.title ||
      advisor.recentCompletions[0] ||
      (review.nextStep && !/не выбран/i.test(review.nextStep)) ||
      projectContext ||
      advisor.stuckScore >= 0.45 ||
      advisor.breakDue ||
      advisor.dominantFile ||
      advisor.topQueryThemes.length > 0 ||
      hasActionableAdvisorSignals(advisor),
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
  if (/(?:ошибк|отлад|stack|буфер)/i.test(anchor)) {
    return "тип совета: debug — один конкретный шаг проверки или команда";
  }
  if (/(?:промпт|буфер|код|фрагмент)/i.test(anchor)) {
    return "тип совета: prompt-example — готовый пример промпта или команды в кавычках";
  }
  if (/(?:перерыв|отдох)/i.test(anchor)) {
    return "тип совета: rest — короткий перерыв без нравоучений";
  }
  if (/(?:как идёт|файл|проект)/i.test(anchor)) {
    return "тип совета: next-step — один следующий шаг по файлу или задаче";
  }
  if (isPracticalAnchor(anchor)) {
    return "тип совета: next-step — конкретная польза, не общий вопрос";
  }
  return "";
}

export function formatInitiativeContextForPrompt(
  bundle: InitiativeSignalBundle,
  maxChars = 1800,
): string {
  const lines: string[] = [];

  if (bundle.editorFile) {
    lines.push(
      `Файл в IDE: ${bundle.editorFile}${bundle.editorRepo ? ` (${bundle.editorRepo})` : ""}`,
    );
  }
  const recentClips = bundle.clipboardSnippets.slice(-3);
  if (recentClips.length) {
    lines.push("Буфер (приоритет):");
    for (const clip of recentClips) {
      lines.push(`- (${clip.kind}) ${clip.text}`);
    }
  }
  if (bundle.window) {
    lines.push(
      `Активное окно: ${bundle.window.processName} — ${bundle.window.title}`,
    );
  }
  if (bundle.projectContext) {
    lines.push(bundle.projectContext);
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

  return lines.join("\n").slice(0, maxChars);
}

function resolveLlmBundle(
  options: ProactivePackageOptions,
): ProactiveLlmBundle | undefined {
  return options.llmBundle;
}

function buildRichContextInput(
  bundle: InitiativeSignalBundle,
  options: ProactivePackageOptions,
  tone: ProactiveReplyTone,
): Parameters<typeof buildRichProactiveContext>[0] {
  const hasSynthesis = Boolean(resolveLlmBundle(options));
  return {
    bundle,
    sessionMinutes: options.sessionMinutes,
    windowMinutes: options.windowMinutes,
    companionSilenceMs: options.companionSilenceMs,
    codingSessionMinutes: options.codingSessionMinutes ?? options.sessionMinutes,
    recentUserMessage: options.recentUserMessage,
    urgency: options.urgency,
    chatTurns: options.recentChatTurns,
    maxChars: hasSynthesis ? 1200 : tone === "advice" ? 2800 : 2000,
  };
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
  const synthesisAnchor = resolveLlmBundle(options)?.mergedAnchor?.trim();
  if (
    synthesisAnchor &&
    (kind === "check_in" || kind === "process_advice") &&
    isInitiativeTopicAllowed(synthesisAnchor, banned, {
      currentFile: bundle.editorFile,
    })
  ) {
    return synthesisAnchor;
  }

  switch (kind) {
    case "check_in":
    case "process_advice": {
      const anchor =
        pickPlannedInitiativeAnchor(options.conversationTopics ?? [], {
          recentProactive: banned,
          windowTitle: options.windowTitle,
          dominantFile: bundle.editorFile,
        }) ??
        buildFallbackInitiativeTopics(bundle, banned)[0];
      return anchor;
    }
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
        const anchor = options.taskTitle;
        return isInitiativeTopicAllowed(anchor, banned) ? anchor : undefined;
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
  proactiveReplyTone?: ProactiveReplyTone;
}): string {
  const { kind, bundle, banned, anchor, conversationTopics = [] } = input;
  const options = input.options ?? {};
  const llmBundle = resolveLlmBundle(options);
  const tone =
    input.proactiveReplyTone ??
    resolveProactiveReplyTone({
      initiativeKind: kind,
      advisorAngle: options.advisorAngle,
      anchor,
      bundle,
      conversationTopics,
      urgencyLevel: options.urgency?.level,
      llmTone: llmBundle?.tone,
    });
  const kindIntent = buildKindIntent(kind, bundle, options);
  const liveliness = describeProactiveLiveliness(kind);
  const toneGuide = describeProactiveTone(tone);
  const isAdvice = tone === "advice";
  const synthesis = llmBundle;
  const adviceTypeHint = isAdvice ? adviceTypeForAnchor(anchor) : "";
  const richInput = buildRichContextInput(bundle, options, tone);
  const richBlock = buildRichProactiveContext(richInput);
  const signalBlock = formatInitiativeContextForPrompt(
    bundle,
    synthesis ? (isAdvice ? 1600 : 1200) : isAdvice ? 2800 : 2000,
  );
  const smalltalkAngles =
    !isAdvice && !synthesis ? buildSmalltalkAngles(bundle, banned) : [];
  const adviceBrief =
    isAdvice && !synthesis ? buildAdviceBrief(options.urgency, bundle) : "";
  const adviceTopicKey = isAdvice
    ? buildAdviceTopicKey({
        anchor,
        signalSummary:
          options.urgency?.reasons.join("; ") ??
          synthesis?.primaryChainSummary ??
          synthesis?.narrativeBrief,
        processName: bundle.window?.processName,
        windowTitle: bundle.window?.title,
      })
    : "";
  const adviceMemory = isAdvice
    ? describeAdviceMemoryForPrompt(adviceTopicKey)
    : "";
  const adviceOutcomes = isAdvice
    ? describeAdviceOutcomesForPrompt(adviceTopicKey)
    : "";

  const synthesisBlock = synthesis
    ? [
        synthesis.primaryChainSummary
          ? `Смысловая цепочка: ${synthesis.primaryChainSummary}.`
          : synthesis.linkedThemes.length
            ? `Связанные нити: ${synthesis.linkedThemes.join(" | ")}.`
            : "",
        synthesis.topicLinks?.length
          ? `Связи: ${synthesis.topicLinks.map((link) => link.label).join(" → ")}.`
          : "",
        `Смысл момента: ${synthesis.narrativeBrief}`,
        synthesis.initiativeMove
          ? `Инициативный ход: ${synthesis.initiativeMove}.`
          : "",
        synthesis.selectedAdviceCandidate
          ? `Выбранный planner-совет: ${synthesis.selectedAdviceCandidate.kind} — ${synthesis.selectedAdviceCandidate.actionText}.`
          : "",
        isAdvice && synthesis.practicalHook
          ? `Конкретный заход: ${synthesis.practicalHook}`
          : "",
        isAdvice &&
        synthesis.adviceSteps?.length &&
        synthesis.initiativeMove !== "context_fact" &&
        synthesis.selectedAdviceCandidate?.kind !== "clarifying_probe" &&
        !synthesis.adviceSteps.every(
          (step) =>
            step.trim() === synthesis.practicalHook?.trim() ||
            synthesis.practicalHook?.includes(step.trim()),
        )
          ? `Конкретные шаги (обязательно отрази один): ${synthesis.adviceSteps.join(" | ")}.`
          : "",
        isAdvice &&
        (synthesis.selectedAdviceCandidate?.kind === "clarifying_probe" ||
          synthesis.initiativeMove === "clipboard_probe" ||
          synthesis.initiativeMove === "ide_invite")
          ? "Это уточняющий вопрос: задай его один раз своими словами, без повтора той же фразы дважды и без «я бы начала с шага»."
          : "",
        isAdvice
          ? "Свяжи минимум два фактора из цепочки в одну рекомендацию: «сделай X, потому что в твоей ситуации это решает Y и Z»; не один изолированный файл или факт."
          : "",
        "Опирайся на связанную цепочку выше — не выбирай из списка тем и не пересказывай сигналы списком.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const shared = [
    liveliness,
    toneGuide,
    VN_CHARACTER_RULE,
    synthesisBlock,
    bundle.moodPrompt && !synthesis
      ? `Настроение Ari сейчас: ${bundle.moodPrompt}`
      : bundle.moodPrompt
        ? `Настроение Ari: ${bundle.moodPrompt.slice(0, 160)}`
        : "",
    kindIntent,
    `Текущее время: ${formatRuDateTime(bundle.advisor.now)}`,
    `Привычный ритм: ${describeRoutineContext(new Date(bundle.advisor.now))}.`,
    isAdvice ? PRACTICAL_INITIATIVE_RULE : PROACTIVE_SMALLTALK_RULE,
    isAdvice
      ? "Если есть данные из поиска или документов — встрой 1–2 проверяемых факта, команду или шаг, но формулируй как Ari, не как справочник."
      : "",
    isAdvice && bundle.clipboardSnippets.length > 0
      ? "В буфере обмена есть свежий фрагмент — строй совет от него: процитируй кусок и дай проверяемый шаг по тому, что пользователь только что копировал."
      : "",
    adviceTypeHint,
    adviceBrief ? `Почему сейчас: ${adviceBrief}` : "",
    adviceMemory,
    adviceOutcomes,
    richBlock
      ? `${synthesis ? "Сырые факты (grounding):" : "Расширенный контекст:"}\n${richBlock}`
      : "",
    signalBlock ? `Доступные сигналы:\n${signalBlock}` : "",
    smalltalkAngles.length
      ? `Возможные смолток-углы (без советов): ${smalltalkAngles.join(" | ")}.`
      : "",
    `Недавние темы инициативы, которые нельзя повторять: ${
      banned.join(" | ") || "нет"
    }.`,
  ];

  if (kind === "check_in") {
    const mergedTopics = synthesis?.linkedThemes ?? conversationTopics;
    return [
      ...shared,
      !synthesis && mergedTopics.length
        ? `Возможные темы (выбери одну, не из запретов): ${mergedTopics.join(" | ")}.`
        : synthesis
          ? "Следуй связанной нити — одна реплика, без меню тем."
          : bundle.hasActionableSignals
            ? isAdvice
              ? "Выбери практическую тему из доступных сигналов — один конкретный шаг или наблюдение."
              : "Выбери тему из доступных сигналов выше — не повторяй недавние инициативы."
            : "Свежих тем нет — дай короткую нейтральную реплику без привязки к старой вкладке.",
      `Доступны свежие темы: ${mergedTopics.length > 0 || bundle.hasActionableSignals || synthesis ? "да" : "нет"}.`,
      `Режим реплики: ${isAdvice ? "совет" : "смолток"}.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    ...shared.filter(Boolean),
    kind === "process_advice" && isAdvice && !anchor
      ? [
          bundle.editorFile || bundle.advisor.editorContext.file
            ? `Текущий файл: ${bundle.editorFile ?? bundle.advisor.editorContext.file}. Дай один конкретный следующий шаг по нему.`
            : "",
          bundle.window
            ? `Сейчас в окне: ${bundle.window.processName} — ${bundle.window.title}.`
            : "",
          "Свежего якоря нет — опирайся на сигналы выше, но реплика должна быть практическим советом, не смолток.",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    `Режим реплики: ${isAdvice ? "совет" : "смолток"}.`,
  ]
    .filter(Boolean)
    .join("\n");
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
  const llmBundle = resolveLlmBundle(options);
  const proactiveReplyTone = resolveProactiveReplyTone({
    initiativeKind: kind,
    advisorAngle: options.advisorAngle,
    anchor,
    bundle,
    conversationTopics,
    urgencyLevel: options.urgency?.level,
    llmTone: llmBundle?.tone,
  });
  const eventDescription = buildProactiveInitiativeContext({
    kind,
    bundle,
    banned,
    anchor,
    conversationTopics,
    options,
    proactiveReplyTone,
  });

  const plannedCheckFreshTopics =
    kind === "check_in"
      ? hasUsableProactiveContext(bundle, conversationTopics, banned)
      : undefined;

  const hasRichContext =
    bundle.hasActionableSignals ||
    conversationTopics.length > 0 ||
    Boolean(options.advisorAngle) ||
    Boolean(anchor);

  const tone = proactiveReplyTone;
  const richInput = buildRichContextInput(bundle, options, tone);
  const proactiveSignalSummary = llmBundle
    ? buildProactiveSummaryFromBundle(llmBundle)
    : buildProactiveSignalSummary(richInput);

  return {
    eventDescription,
    initiativeKind: kind,
    initiativeAnchor: anchor,
    softInitiativeAnchor: true,
    bannedProactiveTopics: banned,
    plannedCheckFreshTopics,
    skipLlmGate:
      kind === "check_in" ||
      Boolean(llmBundle) ||
      (hasRichContext &&
        (kind === "process_advice" || kind === "unfinished_thread")),
    proactiveReplyTone,
    advisorAngle: options.advisorAngle,
    proactiveSignalSummary,
    llmBundle,
  };
}
