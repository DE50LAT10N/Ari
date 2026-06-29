import type { InitiativeKind } from "./initiativeKinds";
import {
  buildAdvisorContext,
  type AdvisorContext,
} from "./advisorContext";
import type { ActivitySignal } from "../memory/activitySignals";
import type { InitiativeSignalBundle } from "./initiativeContext";
import {
  isProactiveSubjectOnCooldown,
  normalizeProactiveSubject,
} from "./proactiveState";

const FRESH_QUERY_MS = 2 * 60 * 60 * 1000;
const BROWSER_STALE_MS = 45 * 60 * 1000;

export const PRACTICAL_INITIATIVE_RULE =
  "Одна короткая реплика с практической пользой: конкретный совет, готовый пример промпта в кавычках, команда, настройка или следующий шаг. Без пустого восторга («круто», «магия») и без вопроса «хочешь посмотреть?» без готового примера.";

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 4);
}

export function topicOverlapsRecent(topic: string, recent: string[]): boolean {
  const words = significantWords(topic);
  if (!words.length) {
    return false;
  }
  if (
    recent.some(
      (entry) =>
        normalizeProactiveSubject(entry) === normalizeProactiveSubject(topic),
    )
  ) {
    return true;
  }
  return recent.some((entry) => {
    const recentWords = significantWords(entry);
    return words.filter((word) => recentWords.includes(word)).length >= 2;
  });
}

export function isInitiativeTopicAllowed(
  topic: string,
  excludeRecent: string[],
): boolean {
  if (!topic.trim()) {
    return false;
  }
  if (topicOverlapsRecent(topic, excludeRecent)) {
    return false;
  }
  if (isProactiveSubjectOnCooldown(topic)) {
    return false;
  }
  return true;
}

function themeMatchesLiveContext(theme: string, ctx: AdvisorContext): boolean {
  const haystack = [
    ctx.currentTitle,
    ctx.dominantFile,
    ctx.dominantRepo,
    ctx.currentProcess,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) {
    return false;
  }
  return significantWords(theme).some((word) => haystack.includes(word));
}

function isQueryThemeFresh(ctx: AdvisorContext, theme: string): boolean {
  const signals = ctx.activitySummary.recentSignals.filter(
    (entry): entry is Extract<ActivitySignal, { kind: "query_topic" }> =>
      entry.kind === "query_topic" && entry.topic === theme,
  );
  if (!signals.length) {
    return false;
  }
  const latest = signals.reduce((left, right) =>
    left.at > right.at ? left : right,
  );
  const age = ctx.now - latest.at;
  if (age > FRESH_QUERY_MS) {
    return false;
  }
  if (
    latest.source === "browser" &&
    age > BROWSER_STALE_MS &&
    !themeMatchesLiveContext(theme, ctx)
  ) {
    return false;
  }
  return true;
}

export function pickPlannedInitiativeAnchor(
  topics: string[],
  options: {
    recentProactive?: string[];
    windowTitle?: string;
    dominantFile?: string;
  } = {},
): string | undefined {
  const recent = options.recentProactive ?? [];
  const fresh = topics.filter((topic) => isInitiativeTopicAllowed(topic, recent));

  const debugTopic = fresh.find((topic) =>
    /ошибк|отлад|буфер|блокер/i.test(topic),
  );
  if (debugTopic) {
    return debugTopic;
  }

  const clipboardTopic = fresh.find((topic) =>
    /буфер|промпт|ссылк|взгляд/i.test(topic),
  );
  if (clipboardTopic) {
    return clipboardTopic;
  }

  const practical = fresh.find((topic) =>
    /связ.*задач|связанн.*задач|актуально|прошло|задач|шаг/i.test(topic),
  );
  if (practical) {
    return practical;
  }

  const fileTopic = fresh.find((topic) => /^как идёт /i.test(topic));
  if (fileTopic) {
    return fileTopic;
  }

  if (fresh.length) {
    return fresh[0];
  }

  if (options.dominantFile) {
    const anchor = `как идёт ${options.dominantFile}`;
    if (isInitiativeTopicAllowed(anchor, recent)) {
      return anchor;
    }
  }

  const title = options.windowTitle?.trim().slice(0, 120);
  if (title && isInitiativeTopicAllowed(title, recent)) {
    return title;
  }

  return undefined;
}

export type AdvisorAngle =
  | "rest"
  | "debug_help"
  | "refocus"
  | "scope"
  | "celebrate"
  | "topic";

export function selectAdvisorAngle(ctx: AdvisorContext): AdvisorAngle | null {
  if (!ctx.enabled) {
    return null;
  }

  if (ctx.breakDue) {
    return "rest";
  }
  if (ctx.repeatedErrorSignature && ctx.stuckScore >= 0.45) {
    return "debug_help";
  }
  if (ctx.stuckScore >= 0.6) {
    return "debug_help";
  }
  if (ctx.contextThrash) {
    return "refocus";
  }
  if (ctx.scopeCreep) {
    return "scope";
  }
  if (ctx.progressWin) {
    return "celebrate";
  }
  if (
    ctx.topQueryThemes.length > 0 ||
    ctx.dominantFile ||
    ctx.taskActivityLink?.shouldAsk ||
    ctx.activitySummary.recentSignals.length >= 3
  ) {
    return "topic";
  }
  return null;
}

/** True when advisor has enough signal to emit process_advice without a specific angle. */
export function hasActionableAdvisorSignals(ctx: AdvisorContext): boolean {
  if (!ctx.enabled) {
    return false;
  }
  return (
    ctx.breakDue ||
    ctx.stuckScore >= 0.45 ||
    ctx.contextThrash ||
    ctx.scopeCreep ||
    Boolean(ctx.progressWin) ||
    ctx.topQueryThemes.length > 0 ||
    Boolean(ctx.dominantFile) ||
    Boolean(ctx.taskActivityLink) ||
    ctx.activitySummary.recentSignals.length >= 2 ||
    Boolean(ctx.activeFocusSession?.currentStep) ||
    (ctx.activeFocusSession?.blockers?.length ?? 0) > 0
  );
}

export function initiativeKindForAngle(angle: AdvisorAngle): InitiativeKind {
  switch (angle) {
    case "rest":
      return "break_suggestion";
    case "debug_help":
    case "refocus":
    case "scope":
      return "process_advice";
    case "celebrate":
    case "topic":
      return "check_in";
  }
}

function activityPlace(ctx: AdvisorContext): string {
  const parts = [
    ctx.currentProcess,
    ctx.currentTitle,
    ctx.dominantFile ? `файл ${ctx.dominantFile}` : "",
    ctx.dominantRepo ? `репо ${ctx.dominantRepo}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "недавняя активность";
}

export function buildAdvisorAngleIntent(
  ctx: AdvisorContext,
  angle: AdvisorAngle,
): string {
  switch (angle) {
    case "rest":
      return [
        "Судя по активности, человек давно в одном ритме — мягко предложи короткий перерыв.",
        `Сессия около ${Math.max(ctx.sessionMinutes, ctx.windowMinutes)} мин; комфортный перерыв ~${ctx.focusPrefs.preferredBreakLengthMinutes} мин.`,
        ctx.offPeak
          ? "Сейчас не его типичное продуктивное окно — можно предложить лёгкий перерыв без давления."
          : "",
        ctx.routineHint ? `Привычный ритм: ${ctx.routineHint}.` : "",
        `Контекст: ${activityPlace(ctx)}.`,
        "Одно короткое сообщение от Ari, без нравоучений. Не говори, что видишь экран.",
      ]
        .filter(Boolean)
        .join("\n");
    case "debug_help":
      return [
        "Судя по активности, человек, похоже, застрял на одной ошибке или файле.",
        ctx.repeatedErrorSignature
          ? `Повторяющаяся ошибка: ${ctx.repeatedErrorSignature.slice(0, 140)}.`
          : "",
        ctx.dominantFile ? `Долго в файле: ${ctx.dominantFile}.` : "",
        ctx.activeFocusSession?.blockers?.length
          ? `Блокеры: ${ctx.activeFocusSession.blockers.slice(0, 3).join("; ")}.`
          : "",
        ctx.activeFocusSession?.currentStep
          ? `Шаг фокуса: ${ctx.activeFocusSession.currentStep.slice(0, 120)}.`
          : "",
        "Предложи один конкретный следующий шаг отладки или проверки — без перечисления всего списка.",
        "Не говори, что видишь экран. Звучи как Ari рядом.",
      ]
        .filter(Boolean)
        .join("\n");
    case "refocus":
      return [
        "Судя по активности, много переключений между окнами и контекстами.",
        ctx.workingMemory.windowSwitchCount
          ? `Переключений: ${ctx.workingMemory.windowSwitchCount}.`
          : "",
        ctx.topQueryThemes.length
          ? `Недавние темы: ${ctx.topQueryThemes.slice(0, 3).join("; ")}.`
          : "",
        "Мягко предложи один фокус на 10–15 минут или маленький следующий шаг.",
        "Не говори, что следишь за экраном.",
      ]
        .filter(Boolean)
        .join("\n");
    case "scope":
      return [
        "Судя по активности, открыто много параллельных хвостов и контекстов.",
        `Открытых задач: ${ctx.openTaskCount}.`,
        ctx.dominantFile ? `Сейчас чаще всего: ${ctx.dominantFile}.` : "",
        "Предложи сузить scope — один приоритет или один следующий шаг.",
        "Без давления и без нравоучений.",
      ]
        .filter(Boolean)
        .join("\n");
    case "celebrate":
      return [
        "Судя по активности, недавно был заметный прогресс.",
        ctx.recentCompletions.length
          ? `Закрыто: ${ctx.recentCompletions.slice(0, 3).join("; ")}.`
          : "",
        "Коротко отметь прогресс и, если уместно, спроси про следующий маленький шаг.",
        "Без пафоса. Не говори, что видишь экран.",
      ]
        .filter(Boolean)
        .join("\n");
    case "topic": {
      const themes = [
        ctx.dominantFile,
        ctx.dominantRepo,
        ...ctx.activitySummary.recentQueryTopics
          .filter((theme) => isQueryThemeFresh(ctx, theme))
          .slice(0, 2),
      ].filter((value): value is string => Boolean(value));
      const uniqueThemes = [
        ...new Set(themes.map((theme) => theme.toLowerCase())),
      ].map(
        (key) => themes.find((theme) => theme.toLowerCase() === key) ?? key,
      );
      return [
        "Мягкая проверка связи — можно спросить про недавнюю работу.",
        uniqueThemes.length ? `Недавние темы: ${uniqueThemes.join("; ")}.` : "",
        ctx.taskActivityLink?.shouldAsk
          ? `Уточни без давления: ${ctx.taskActivityLink.reason}.`
          : ctx.taskActivityLink?.taskTitle
            ? `Похоже, активность связана с задачей: ${ctx.taskActivityLink.taskTitle}.`
            : "",
        ctx.routineHint ? `Ритм: ${ctx.routineHint}.` : "",
        "Не притворяйся, что видишь экран.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    default:
      return "Мягкая проактивная реплика по текущему контексту.";
  }
}

export function buildConversationTopics(
  ctx: AdvisorContext,
  limit = 5,
  excludeRecent: string[] = [],
  bundle?: InitiativeSignalBundle,
): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();

  const push = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      return;
    }
    if (!isInitiativeTopicAllowed(trimmed, excludeRecent)) {
      return;
    }
    seen.add(trimmed.toLowerCase());
    topics.push(trimmed);
  };

  if (bundle?.focusBlockers[0]) {
    push(`помочь с блокером: ${bundle.focusBlockers[0].slice(0, 80)}`);
  }

  if (bundle?.clipboardSnippets.length) {
    const clip = bundle.clipboardSnippets[bundle.clipboardSnippets.length - 1];
    if (clip.kind === "stacktrace") {
      push("следующий шаг отладки по ошибке из буфера");
    } else if (clip.kind === "code") {
      push("подсказка по фрагменту кода из буфера");
    } else if (clip.kind === "url") {
      push(`что полезного в ссылке из буфера`);
    }
  }

  if (bundle?.visionSummary) {
    push("короткий практический вывод по последнему взгляду на экран");
  }

  if (ctx.taskActivityLink?.shouldAsk) {
    push(`уточнить связь активности с задачей «${ctx.taskActivityLink.taskTitle?.slice(0, 80)}»`);
  } else if (ctx.taskActivityLink?.taskTitle) {
    push(`следующий шаг по связанной задаче «${ctx.taskActivityLink.taskTitle.slice(0, 80)}»`);
  }

  push(ctx.dominantFile ? `как идёт ${ctx.dominantFile}` : undefined);

  if (bundle?.projectContext) {
    const pinned = bundle.projectContext
      .split("\n")
      .find((line) => line.startsWith("- "));
    if (pinned) {
      push(`как идёт ${pinned.replace(/^- /, "").slice(0, 80)} в проекте`);
    }
  }

  const seenBrowserThemes = new Set<string>();
  for (const entry of ctx.activitySummary.recentSignals.slice().reverse()) {
    if (topics.length >= limit) {
      break;
    }
    if (entry.kind !== "query_topic" || entry.source !== "browser") {
      continue;
    }
    const key = entry.topic.toLowerCase();
    if (seenBrowserThemes.has(key)) {
      continue;
    }
    seenBrowserThemes.add(key);
    if (!isQueryThemeFresh(ctx, entry.topic)) {
      continue;
    }
    push(`что нашёл по «${entry.topic}»`);
  }

  for (const entry of ctx.activitySummary.recentSignals.slice().reverse()) {
    if (topics.length >= limit) {
      break;
    }
    if (entry.kind === "clipboard" && entry.clipKind === "stacktrace") {
      push("получилось ли разобраться с ошибкой из буфера");
    }
    if (
      entry.kind === "query_topic" &&
      entry.source === "browser" &&
      isQueryThemeFresh(ctx, entry.topic)
    ) {
      push(`ещё актуально «${entry.topic}»`);
    }
  }

  if (bundle?.dailyNextStep && !/не выбран/i.test(bundle.dailyNextStep)) {
    push(`мягко напомнить про «${bundle.dailyNextStep.slice(0, 80)}»`);
  }

  if (bundle?.nextTaskTitle) {
    push(`следующий шаг по задаче «${bundle.nextTaskTitle.slice(0, 80)}»`);
  }

  if (ctx.recentCompletions[0]) {
    push(`как прошло «${ctx.recentCompletions[0]}»`);
  }

  if (ctx.breakDue) {
    push("короткий перерыв после долгой сессии");
  }

  return topics.slice(0, limit);
}

export function buildAdvisorDiagnostics(ctx: AdvisorContext): {
  angle: AdvisorAngle | null;
  flags: string;
  topics: string[];
} {
  const angle = selectAdvisorAngle(ctx);
  return {
    angle,
    flags: [
      ctx.breakDue ? "breakDue" : null,
      ctx.stuckScore >= 0.5 ? "stuck" : null,
      ctx.contextThrash ? "thrash" : null,
      ctx.scopeCreep ? "scope" : null,
      ctx.progressWin ? "win" : null,
      ctx.offPeak ? "offPeak" : null,
    ]
      .filter(Boolean)
      .join(", ") || "none",
    topics: buildConversationTopics(ctx),
  };
}

export { buildAdvisorContext };
