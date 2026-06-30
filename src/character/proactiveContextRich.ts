import type { AdviceUrgency } from "./adviceUrgency";
import { describePresenceScene, type PresenceScene } from "./presence";
import { isInitiativeTopicAllowed } from "./advisorEngine";
import type { InitiativeSignalBundle } from "./initiativeContext";
import { pruneWorkingMemory } from "../memory/workingMemory";
import { formatGoalLedgerForPrompt } from "../tasks/goalLedger";

export type RichProactiveContextInput = {
  bundle: InitiativeSignalBundle;
  sessionMinutes?: number;
  windowMinutes?: number;
  companionSilenceMs?: number;
  codingSessionMinutes?: number;
  recentUserMessage?: string;
  urgency?: AdviceUrgency;
  chatTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  maxChars?: number;
};

const WM_KIND_LABELS: Record<string, string> = {
  window_switch: "переключение",
  chat_question: "вопрос",
  user_action: "действие",
  distraction: "отвлечение",
  screen_glance: "взгляд",
  focus_update: "фокус",
  process_note: "заметка",
};

function formatMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

function stripEmotionTags(text: string): string {
  return text.replace(/<emotion>[^<]+<\/emotion>/gi, "").trim();
}

export function buildAdviceBrief(
  urgency: AdviceUrgency | undefined,
  bundle: InitiativeSignalBundle,
): string {
  const parts: string[] = [];
  if (urgency && urgency.level !== "none") {
    parts.push(
      `срочность ${urgency.level} (${urgency.score}): ${urgency.reasons.join("; ")}`,
    );
  }
  if (bundle.editorFile) {
    parts.push(`фокус на ${bundle.editorFile}`);
  }
  const stack = bundle.clipboardSnippets.find((clip) => clip.kind === "stacktrace");
  if (stack) {
    parts.push("свежая ошибка в буфере");
  }
  if (bundle.advisor.repeatedErrorSignature) {
    parts.push("повторяющаяся ошибка в сессии");
  }
  return parts.join(" · ") || "есть практический повод по текущим сигналам";
}

export function buildSmalltalkAngles(
  bundle: InitiativeSignalBundle,
  banned: string[] = [],
): string[] {
  const angles: string[] = [];
  const seen = new Set<string>();
  const push = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    if (!isInitiativeTopicAllowed(trimmed, banned)) {
      return;
    }
    seen.add(key);
    angles.push(trimmed);
  };

  if (bundle.moodPrompt) {
    push(`лёгкая реплика в духе настроения: ${bundle.moodPrompt.slice(0, 80)}`);
  }

  const hour = new Date(bundle.advisor.now).getHours();
  let scene: PresenceScene = "focus";
  if (hour < 6 || hour >= 23) {
    scene = "night";
  } else if (hour < 11) {
    scene = "morning";
  } else if (hour >= 19) {
    scene = "evening";
  }
  push(`атмосфера момента (${describePresenceScene(scene)}) — без советов и планов`);
  push("боковая живая тема: странная бытовая мысль, музыка, игра, еда или настроение — без привязки к текущему файлу");
  push("новостной или культурный повод как ассоциация, без утверждения конкретной свежей новости без live-проверки");
  push("маленькая интересная заметка из мира технологий или культуры, сформулированная как смолток, не как справка");

  const wmRecent = pruneWorkingMemory(bundle.advisor.now).slice(-6).reverse();
  for (const entry of wmRecent) {
    if (angles.length >= 5) {
      break;
    }
    if (entry.kind === "distraction" && entry.app) {
      push(`мягко заметить, что недавно мелькало ${entry.app}`);
    } else if (entry.kind === "window_switch" && entry.title) {
      push(`наблюдение про недавнее окно: ${entry.title.slice(0, 60)}`);
    }
  }

  if (bundle.window && !bundle.editorFile) {
    push(
      `короткий комментарий про ${bundle.window.processName} — без притворства, что видишь экран`,
    );
  }

  if (bundle.recentCompletion) {
    push(`порадоваться недавнему завершению: ${bundle.recentCompletion.slice(0, 60)}`);
  }

  return angles.slice(0, 5);
}

export function buildRichProactiveContext(
  input: RichProactiveContextInput,
): string {
  const { bundle } = input;
  const lines: string[] = [];
  const sessionMinutes =
    input.codingSessionMinutes ?? input.sessionMinutes ?? bundle.advisor.sessionMinutes;
  const windowMinutes =
    input.windowMinutes ?? bundle.advisor.windowMinutes;

  if (sessionMinutes > 0 || windowMinutes > 0) {
    lines.push(
      `Сессия: в ритме работы ~${sessionMinutes} мин, текущее окно ~${windowMinutes} мин.`,
    );
  }

  if (input.companionSilenceMs !== undefined && input.companionSilenceMs > 0) {
    lines.push(
      `С пользователем не общались ~${formatMinutes(input.companionSilenceMs)} мин.`,
    );
  }

  const wmRecent = pruneWorkingMemory(bundle.advisor.now).slice(-6);
  if (wmRecent.length) {
    lines.push("Кратковременная память:");
    for (const entry of wmRecent) {
      const label = WM_KIND_LABELS[entry.kind] ?? entry.kind;
      const place =
        entry.app || entry.title
          ? ` (${[entry.app, entry.title].filter(Boolean).join(" — ")})`
          : "";
      lines.push(`- [${label}] ${entry.topic.slice(0, 100)}${place}`);
    }
  }

  if (bundle.advisor.topQueryThemes.length) {
    lines.push(
      `Недавние темы поиска: ${bundle.advisor.topQueryThemes.slice(0, 4).join(" | ")}`,
    );
  }

  const recentQueries = bundle.advisor.activitySummary.recentSignals
    .filter((entry) => entry.kind === "query_topic")
    .slice(-3)
    .map((entry) => entry.topic);
  if (recentQueries.length) {
    lines.push(`Свежие запросы: ${recentQueries.join(" | ")}`);
  }

  if (bundle.nextTaskTitle) {
    lines.push(`Открытая задача: ${bundle.nextTaskTitle}`);
  }
  if (bundle.taskActivityLink?.taskTitle) {
    lines.push(
      bundle.taskActivityLink.shouldAsk
        ? `Уточнить связь с задачей «${bundle.taskActivityLink.taskTitle}»`
        : `Похоже на задачу «${bundle.taskActivityLink.taskTitle}»`,
    );
  }

  const goals = formatGoalLedgerForPrompt(2);
  if (goals) {
    lines.push(`Цели:\n${goals}`);
  }

  if (input.urgency && input.urgency.level !== "none") {
    lines.push(
      `Срочность совета: ${input.urgency.level} (${input.urgency.score}) — ${input.urgency.reasons.join("; ")}`,
    );
  }

  const recentUser =
    input.recentUserMessage?.trim() ||
    [...(input.chatTurns ?? [])]
      .reverse()
      .find((turn) => turn.role === "user")
      ?.content;
  if (recentUser) {
    lines.push(
      `Последний вопрос пользователя: ${stripEmotionTags(recentUser).slice(0, 120)}`,
    );
  }

  const recentDialog = (input.chatTurns ?? []).slice(-4);
  if (recentDialog.length) {
    lines.push("Недавний диалог:");
    for (const turn of recentDialog) {
      const role = turn.role === "user" ? "пользователь" : "Ari";
      lines.push(
        `- ${role}: ${stripEmotionTags(turn.content).slice(0, 120)}`,
      );
    }
  }

  const maxChars = input.maxChars ?? 2600;
  return lines.join("\n").slice(0, maxChars);
}

export function buildProactiveSignalSummary(
  input: RichProactiveContextInput,
): string {
  return buildRichProactiveContext({ ...input, maxChars: 900 });
}
