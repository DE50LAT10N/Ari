import type { CharacterEmotion } from "../types/character";
import { formatRuDateTime } from "./datetime";
import type { InitiativeKind } from "./initiativeKinds";
import type { PresenceScene } from "./presence";
import type { SilentReactionKind } from "./silentReactions";
import { pickPackReaction, type ScenarioPackReaction } from "./scenarioPacks";
import {
  isCodingProcess as checkCodingProcess,
  isDistractingWindow,
} from "../platform/windowContext";

export type Scenario =
  | "app_start"
  | "first_message_today"
  | "return_after_absence"
  | "deep_work_detected"
  | "late_night_work"
  | "build_failed"
  | "build_succeeded"
  | "task_completed"
  | "shutdown"
  | "ignored_initiative"
  | "reminder_due"
  | "long_silence"
  | "window_switch"
  | "long_session"
  | "scheduled_check"
  | "repeated_click"
  | "chat_return";

export type ScenarioOutcome =
  | {
      kind: "silent";
      reaction: SilentReactionKind;
      scenario: Scenario;
      emotion: CharacterEmotion;
    }
  | {
      kind: "initiative";
      description: string;
      initiativeKind: InitiativeKind;
      scenario: Scenario;
      emotion: CharacterEmotion;
    }
  | {
      kind: "local";
      line: string;
      emotion: CharacterEmotion;
      scenario: Scenario;
    }
  | { kind: "noop"; scenario: Scenario };

export type ScenarioContext = {
  scenario: Scenario;
  scene: PresenceScene;
  hour: number;
  idleSeconds: number;
  chatOpen: boolean;
  characterState: string;
  windowTitle?: string;
  processName?: string;
  previousProcessName?: string;
  previousWindowMinutes?: number;
  absentMinutes?: number;
  chatClosedMinutes?: number;
  reminderText?: string;
  reminderDueAt?: number;
  openLoopLines?: string[];
  ritual?: "morning" | "midday" | "evening";
  ritualTone?: string;
  routineContext?: string;
  recentTopics?: string[];
  focusSessionActive?: boolean;
};

const SCENARIO_TIMES_KEY = "desktop-character.scenario-times.v1";

export type ScenarioDefinition = {
  id: Scenario;
  cooldownMs: number;
  allowedScenes: PresenceScene[];
  canSpeak: boolean;
  canUseSilentReaction: boolean;
  preferredEmotions: CharacterEmotion[];
  promptHint?: string;
  localLines?: string[];
  silentReaction?: SilentReactionKind;
  initiativeKind?: InitiativeKind;
  buildDescription?: (ctx: ScenarioContext) => string;
};

const ALL_SCENES: PresenceScene[] = [
  "morning",
  "focus",
  "break",
  "evening",
  "night",
  "away",
];

const scenarioDefinitions: ScenarioDefinition[] = [
  {
    id: "app_start",
    cooldownMs: 8 * 60 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: false,
    canUseSilentReaction: true,
    preferredEmotions: ["curious"],
    silentReaction: "startup",
  },
  {
    id: "return_after_absence",
    cooldownMs: 10 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: true,
    preferredEmotions: ["curious", "happy"],
    silentReaction: "return",
    localLines: [
      "Снова здесь. Я заметила.",
      "Вернулся — хорошо.",
      "Пауза закончилась?",
    ],
    initiativeKind: "return_reaction",
    buildDescription: (ctx) =>
      ctx.absentMinutes
        ? ctx.previousProcessName &&
          isDistractingWindow(ctx.previousProcessName)
          ? `Пользователь около ${ctx.absentMinutes} минут был в ${ctx.previousProcessName}. Теперь переключился на другое окно. Можно коротко и по-дружески отметить, что он вернулся из игры или сериала — без слежки и без обязательного вопроса.`
          : `Пользователь вернулся к компьютеру после примерно ${ctx.absentMinutes} минут отсутствия. Можно коротко и естественно заметить возвращение, не упоминая слежение и не задавая обязательный вопрос.`
        : "Пользователь вернулся после паузы. Можно естественно отметить возвращение, без формального приветствия.",
  },
  {
    id: "chat_return",
    cooldownMs: 10 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: true,
    preferredEmotions: ["curious"],
    silentReaction: "return",
    localLines: [
      "Снова в чате. Продолжим?",
      "Долго не писали — я тут.",
    ],
    initiativeKind: "return_reaction",
    buildDescription: () =>
      "Пользователь вернулся к Ari после долгой паузы. Можно естественно отметить возвращение, без формального приветствия.",
  },
  {
    id: "repeated_click",
    cooldownMs: 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: true,
    preferredEmotions: ["annoyed", "amused"],
    silentReaction: "repeated_click",
    initiativeKind: "check_in",
    buildDescription: () =>
      "Пользователь несколько раз быстро нажал на Ari. Можно коротко и характерно отреагировать на назойливое внимание.",
  },
  {
    id: "build_failed",
    cooldownMs: 10 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: true,
    preferredEmotions: ["worried", "pensive", "annoyed"],
    silentReaction: "build_failed",
    initiativeKind: "context_comment",
    buildDescription: () =>
      "Сборка или тесты упали. Коротко отметить это по делу, без нотаций и без длинного разбора.",
  },
  {
    id: "build_succeeded",
    cooldownMs: 20 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: false,
    canUseSilentReaction: true,
    preferredEmotions: ["happy"],
    silentReaction: "build_success",
  },
  {
    id: "long_silence",
    cooldownMs: 15 * 60_000,
    allowedScenes: ["break", "evening", "away"],
    canSpeak: false,
    canUseSilentReaction: true,
    preferredEmotions: ["bored"],
    silentReaction: "long_silence",
    localLines: [
      "Тишина затянулась.",
      "Долго молчим. Я рядом.",
      "Тихо. Не против.",
    ],
  },
  {
    id: "first_message_today",
    cooldownMs: 12 * 60 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: false,
    preferredEmotions: ["happy", "curious"],
    initiativeKind: "check_in",
    localLines: [
      "Новый слот дня — можно коротко поздороваться.",
      "Середина дня. Как идёт?",
      "Вечер. Можно подвести итог без давления.",
    ],
    buildDescription: (ctx) => {
      const tone = ctx.ritualTone ? `Тон: ${ctx.ritualTone}. ` : "";
      if (ctx.ritual === "morning") {
        return `${tone}Утренний момент: можно мягко обозначить начало дня или помочь выбрать фокус. Незавершённые намерения: ${ctx.openLoopLines?.join(" | ") || "нет"}. Привычный ритм: ${ctx.routineContext || "неизвестен"}. Пиши только если есть естественный повод.`;
      }
      if (ctx.ritual === "midday") {
        return `${tone}Полуденный момент: короткий чек-ин середины дня — как идёт, нужна ли пауза, без долгого разговора. Незавершённые намерения: ${ctx.openLoopLines?.join(" | ") || "нет"}. Привычный ритм: ${ctx.routineContext || "неизвестен"}.`;
      }
      return `${tone}Вечерний момент: можно коротко отметить итог дня или незавершённое дело без давления. Незавершённые намерения: ${ctx.openLoopLines?.join(" | ") || "нет"}. Привычный ритм: ${ctx.routineContext || "неизвестен"}.`;
    },
  },
  {
    id: "reminder_due",
    cooldownMs: 30 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: false,
    preferredEmotions: ["curious", "empathetic"],
    initiativeKind: "unfinished_thread",
    buildDescription: (ctx) =>
      [
        "Наступил срок сохранённого намерения пользователя.",
        `Намерение: ${ctx.reminderText || "без текста"}`,
        ctx.reminderDueAt
          ? `Срок был назначен на ${formatRuDateTime(ctx.reminderDueAt)}.`
          : "",
        "Мягко и коротко вернись к нему. Не говори о базе данных, планировщике или системном напоминании.",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  {
    id: "window_switch",
    cooldownMs: 20 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: false,
    preferredEmotions: ["curious"],
    initiativeKind: "context_comment",
    buildDescription: (ctx) =>
      [
        `Пользователь около ${ctx.previousWindowMinutes ?? "?"} минут работал в ${ctx.previousProcessName || "приложении"}.`,
        `Теперь переключился в ${ctx.processName || "другое приложение"}.`,
        ctx.windowTitle ? `Новый заголовок окна: ${ctx.windowTitle}.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
  },
  {
    id: "long_session",
    cooldownMs: 20 * 60_000,
    allowedScenes: ["focus", "break", "evening", "night"],
    canSpeak: true,
    canUseSilentReaction: false,
    preferredEmotions: ["empathetic"],
    initiativeKind: "break_suggestion",
    buildDescription: (ctx) => {
      const minutes = ctx.previousWindowMinutes ?? 30;
      if (
        ctx.processName &&
        isDistractingWindow(ctx.processName, ctx.windowTitle ?? "")
      ) {
        return `Пользователь уже около ${minutes} минут в ${ctx.processName}. Заголовок: ${ctx.windowTitle || "неизвестен"}. Можно мягко напомнить про перерыв или просто коротко отметить, что он увлечён — без нотаций.`;
      }
      return `Пользователь уже около ${minutes} минут находится в ${ctx.processName || "одном приложении"}. Заголовок: ${ctx.windowTitle || "неизвестен"}. Возможно, уместно мягко предложить перерыв, но только если это не звучит навязчиво.`;
    },
  },
  {
    id: "scheduled_check",
    cooldownMs: 30 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: false,
    preferredEmotions: ["neutral", "curious"],
    initiativeKind: "check_in",
    buildDescription: (ctx) =>
      ctx.processName
        ? `Мягкая проверка связи после тишины; контекст: ${ctx.processName}.`
        : "Мягкая проверка связи после периода тишины.",
  },
  {
    id: "deep_work_detected",
    cooldownMs: 45 * 60_000,
    allowedScenes: ["focus"],
    canSpeak: true,
    canUseSilentReaction: true,
    preferredEmotions: ["calm", "determined", "proud"],
    silentReaction: "coding_context",
    initiativeKind: "quiet_presence",
    buildDescription: () =>
      "Пользователь долго в коде без переключений. Тихо поддержать фокус одной короткой фразой, без вопросов и без отвлечения.",
  },
  {
    id: "late_night_work",
    cooldownMs: 60 * 60_000,
    allowedScenes: ["night", "evening"],
    canSpeak: true,
    canUseSilentReaction: false,
    preferredEmotions: ["calm", "empathetic"],
    initiativeKind: "check_in",
    promptHint: "Поздняя работа — мягко, без морализаторства.",
    buildDescription: () =>
      "Поздний час, пользователь всё ещё за компьютером. Можно мягко отметить это, без нотаций и без обязательного вопроса.",
  },
  {
    id: "ignored_initiative",
    cooldownMs: 90 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: false,
    canUseSilentReaction: true,
    preferredEmotions: ["bored", "annoyed"],
    silentReaction: "ambient",
  },
  {
    id: "task_completed",
    cooldownMs: 30 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: true,
    canUseSilentReaction: false,
    preferredEmotions: ["happy"],
    initiativeKind: "memory_callback",
    buildDescription: () =>
      "Пользователь завершил задачу или этап работы. Можно коротко отметить прогресс, если это уместно.",
  },
  {
    id: "shutdown",
    cooldownMs: 24 * 60 * 60_000,
    allowedScenes: ALL_SCENES,
    canSpeak: false,
    canUseSilentReaction: false,
    preferredEmotions: ["calm"],
  },
];

const definitionMap = new Map(
  scenarioDefinitions.map((definition) => [definition.id, definition]),
);

function pickPreferredEmotion(
  definition: ScenarioDefinition,
): CharacterEmotion {
  if (!definition.preferredEmotions.length) {
    return "neutral";
  }
  const index = Math.floor(Math.random() * definition.preferredEmotions.length);
  return definition.preferredEmotions[index] ?? "neutral";
}

function pickLocalLine(definition: ScenarioDefinition): string | null {
  if (!definition.localLines?.length) {
    return null;
  }
  const index = Math.floor(Math.random() * definition.localLines.length);
  return definition.localLines[index] ?? null;
}

let scenarioTimesCache: Partial<Record<Scenario, number>> | null = null;

function loadScenarioTimes(): Partial<Record<Scenario, number>> {
  if (scenarioTimesCache) {
    return scenarioTimesCache;
  }
  try {
    scenarioTimesCache = JSON.parse(
      localStorage.getItem(SCENARIO_TIMES_KEY) ?? "{}",
    ) as Partial<Record<Scenario, number>>;
    return scenarioTimesCache;
  } catch {
    scenarioTimesCache = {};
    return scenarioTimesCache;
  }
}

function canRunScenario(scenario: Scenario): boolean {
  const definition = definitionMap.get(scenario);
  if (!definition) return false;
  const last = loadScenarioTimes()[scenario] ?? 0;
  return Date.now() - last >= definition.cooldownMs;
}

export function markScenarioTriggered(scenario: Scenario): void {
  scenarioTimesCache = { ...loadScenarioTimes(), [scenario]: Date.now() };
  localStorage.setItem(
    SCENARIO_TIMES_KEY,
    JSON.stringify(scenarioTimesCache),
  );
}

export function getScenarioPackOverlay(
  scenario: Scenario,
  ctx: ScenarioContext,
): ScenarioPackReaction | null {
  return pickPackReaction({
    scenario,
    scene: ctx.scene,
    hour: ctx.hour,
    focusSessionActive: ctx.focusSessionActive ?? false,
  });
}

export function resolveScenario(
  scenario: Scenario,
  ctx: ScenarioContext,
): ScenarioOutcome {
  const definition = definitionMap.get(scenario);
  if (!definition) {
    return { kind: "noop", scenario };
  }

  if (!canRunScenario(scenario)) {
    return { kind: "noop", scenario };
  }

  if (!definition.allowedScenes.includes(ctx.scene)) {
    return { kind: "noop", scenario };
  }

  if (definition.canSpeak && definition.initiativeKind) {
    const description =
      definition.buildDescription?.(ctx) ?? definition.promptHint ?? "";
    if (description) {
      return {
        kind: "initiative",
        description,
        initiativeKind: definition.initiativeKind,
        scenario,
        emotion: pickPreferredEmotion(definition),
      };
    }
  }

  if (ctx.chatOpen && !definition.canSpeak) {
    if (definition.canUseSilentReaction && definition.silentReaction) {
      return {
        kind: "silent",
        reaction: definition.silentReaction,
        scenario,
        emotion: pickPreferredEmotion(definition),
      };
    }
    const localLine = pickLocalLine(definition);
    if (localLine) {
      return {
        kind: "local",
        line: localLine,
        emotion: pickPreferredEmotion(definition),
        scenario,
      };
    }
    return { kind: "noop", scenario };
  }

  if (definition.canUseSilentReaction && definition.silentReaction) {
    return {
      kind: "silent",
      reaction: definition.silentReaction,
      scenario,
      emotion: pickPreferredEmotion(definition),
    };
  }

  const localLine = pickLocalLine(definition);
  if (localLine) {
    return {
      kind: "local",
      line: localLine,
      emotion: pickPreferredEmotion(definition),
      scenario,
    };
  }

  return { kind: "noop", scenario };
}

export function detectBuildScenario(
  windowTitle: string,
): "build_succeeded" | "build_failed" | null {
  const title = windowTitle.toLowerCase();
  if (
    /(build succeeded|build successful|успешн.*сборк|tests passed|0 errors)/i.test(
      title,
    )
  ) {
    return "build_succeeded";
  }
  if (/(build failed|error|ошибк|exception|failed tests)/i.test(title)) {
    return "build_failed";
  }
  return null;
}

export function isCodingProcess(
  processName: string,
  extraPattern = "",
): boolean {
  return checkCodingProcess(processName, extraPattern);
}

export function isDistractingProcess(
  processName: string,
  title = "",
  extraPattern = "",
): boolean {
  return isDistractingWindow(processName, title, extraPattern);
}

export function matchesForbiddenApp(
  processName: string,
  title: string,
  forbiddenApps: string[],
): boolean {
  const haystack = `${processName} ${title}`.toLowerCase();
  return forbiddenApps.some((app) => {
    const needle = app.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}
