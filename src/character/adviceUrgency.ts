import type { AppSettings } from "../settings/appSettings";
import type { InitiativeSignalBundle } from "./initiativeContext";
import { collectBannedProactiveTopics } from "./initiativeContext";
import {
  MEDIUM_ADVICE_CAP_MS,
  proactiveAdviceIntervalMs,
  URGENT_ADVICE_MIN_MS,
} from "./initiativeConfig";
import type { InitiativeKind } from "./initiativeKinds";
import { isAdviceSubjectRecentlyAdvised } from "./proactiveState";
import { countRecentAdviceByTone, countRecentAdviceStreak } from "./adviceLedger";
import { getProactiveToneSnapshot, isAdviceSkewedToday } from "../memory/memoryTelemetry";
import {
  advisorAngleForAdviceSignals,
  isProactiveWorkContext,
} from "./proactiveTone";
import { pruneWorkingMemory } from "../memory/workingMemory";
import {
  buildConversationTopics,
  buildFallbackInitiativeTopics,
  buildLiveCodingTopic,
  initiativeKindForAngle,
  pickPlannedInitiativeAnchor,
  selectAdvisorAngle,
  type AdvisorAngle,
} from "./advisorEngine";
import { deriveScreenState } from "./screenState";

const CLIPBOARD_FRESH_MS = 15 * 60_000;
const WM_RECENT_MS = 20 * 60_000;
const QUERY_FRESH_MS = 45 * 60_000;

export type AdviceUrgencyLevel = "none" | "low" | "medium" | "high";

export type AdviceUrgency = {
  level: AdviceUrgencyLevel;
  score: number;
  reasons: string[];
  effectiveIntervalMs: number;
  subjectKey?: string;
};

export type SignalDrivenAdvicePlan = {
  kind: InitiativeKind;
  angle?: AdvisorAngle;
  conversationTopics: string[];
  anchor?: string;
};

let lastUrgencySnapshot: AdviceUrgency | null = null;

export function setLastAdviceUrgency(urgency: AdviceUrgency): void {
  lastUrgencySnapshot = urgency;
}

export function getLastAdviceUrgency(): AdviceUrgency | null {
  return lastUrgencySnapshot;
}

function themeMatchesContext(
  theme: string,
  bundle: InitiativeSignalBundle,
): boolean {
  const haystack = [
    bundle.window?.title,
    bundle.editorFile,
    bundle.editorRepo,
    bundle.window?.processName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) {
    return false;
  }
  return theme
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 4)
    .some((word) => haystack.includes(word));
}

export function scoreAdviceUrgency(
  bundle: InitiativeSignalBundle,
  settings: AppSettings,
  options: {
    sessionMinutes?: number;
    userIntervalMs?: number;
    now?: number;
  } = {},
): AdviceUrgency {
  const now = options.now ?? Date.now();
  const sessionMinutes =
    options.sessionMinutes ?? bundle.advisor.sessionMinutes;
  const userIntervalMs =
    options.userIntervalMs ?? proactiveAdviceIntervalMs(settings);
  let score = 0;
  const reasons: string[] = [];
  let subjectKey: string | undefined;

  const freshClipboard = bundle.clipboardSnippets.filter(
    (clip) => now - clip.at <= CLIPBOARD_FRESH_MS,
  );
  const stack = freshClipboard.find((clip) => clip.kind === "stacktrace");
  if (stack) {
    score += 4;
    reasons.push("свежая ошибка в буфере");
    subjectKey = stack.text.slice(0, 80);
  }

  const diagnosticClip = freshClipboard.find((clip) => clip.kind === "diagnostic");
  if (diagnosticClip && !stack) {
    score += 4;
    reasons.push(`свежая диагностика в буфере: ${diagnosticClip.text.slice(0, 70)}`);
    subjectKey = subjectKey ?? diagnosticClip.text.slice(0, 80);
  }

  const codeClip = freshClipboard.find((clip) => clip.kind === "code");
  if (codeClip && !stack && !diagnosticClip) {
    score += 3;
    reasons.push("фрагмент кода в буфере");
    subjectKey = subjectKey ?? codeClip.text.slice(0, 60);
  }

  if (!stack && !diagnosticClip && !codeClip && freshClipboard.length > 0) {
    const genericClip = freshClipboard[freshClipboard.length - 1];
    const boost = genericClip.kind === "url" ? 3 : 2;
    score += boost;
    reasons.push(`содержательный буфер (${genericClip.kind}): ${genericClip.text.slice(0, 70)}`);
    subjectKey = subjectKey ?? genericClip.text.slice(0, 80);
  }

  const repeated = bundle.advisor.repeatedErrorSignature;
  if (repeated && bundle.advisor.activitySummary.repeatedErrorCount >= 2) {
    score += 4;
    reasons.push("повторяющаяся ошибка");
    subjectKey = repeated.slice(0, 80);
  }

  if (bundle.advisor.stuckScore >= 0.45 && bundle.editorFile) {
    score += 3;
    reasons.push(`застрял на ${bundle.editorFile}`);
    subjectKey = subjectKey ?? bundle.editorFile;
  }

  if (
    bundle.editorFile &&
    bundle.advisor.activitySummary.inputFrictionScore >= 1
  ) {
    const friction = bundle.advisor.activitySummary;
    const boost = friction.inputFrictionScore >= 2 ? 3 : 2;
    score += boost;
    reasons.push(
      `похоже на застревание до поиска: ${friction.recentInputPauses} пауз, ${friction.recentInputReturns} возвратов, ${friction.recentCorrectionChurns} исправлений в ${bundle.editorFile}`,
    );
    subjectKey = subjectKey ?? bundle.editorFile;
  }

  if (bundle.taskActivityLink?.shouldAsk) {
    score += 2;
    reasons.push("нужно уточнить связь с задачей");
    subjectKey = subjectKey ?? bundle.taskActivityLink.taskTitle?.slice(0, 80);
  }

  for (const theme of bundle.advisor.topQueryThemes) {
    const signal = bundle.advisor.activitySummary.recentSignals.find(
      (entry) =>
        entry.kind === "query_topic" &&
        entry.topic === theme &&
        now - entry.at <= QUERY_FRESH_MS,
    );
    if (signal && themeMatchesContext(theme, bundle)) {
      score += 2;
      reasons.push(`актуальный поиск: ${theme.slice(0, 60)}`);
      subjectKey = subjectKey ?? theme.slice(0, 80);
      break;
    }
  }

  const screenState = deriveScreenState(bundle);
  if (screenState.visibleProblem && screenState.confidence >= 0.55) {
    score += 2;
    reasons.push(`видна проблема на экране: ${screenState.visibleProblem.slice(0, 60)}`);
    subjectKey = subjectKey ?? screenState.visibleProblem.slice(0, 80);
  }

  const relatedQuery = bundle.advisor.topQueryThemes.find((theme) =>
    themeMatchesContext(theme, bundle),
  );
  if (bundle.editorFile && relatedQuery) {
    score += 1;
    reasons.push(`поиск связан с ${bundle.editorFile}`);
    subjectKey = subjectKey ?? `${bundle.editorFile}:${relatedQuery}`.slice(0, 80);
  }

  if (sessionMinutes >= 3 && bundle.editorFile && score >= 2) {
    score += 1;
    reasons.push(`работа в ${bundle.editorFile}`);
    subjectKey = subjectKey ?? bundle.editorFile;
  }

  const wmRecent = pruneWorkingMemory(now).filter(
    (entry) => now - entry.at <= WM_RECENT_MS,
  );
  const wmChatOrFocus = wmRecent.some(
    (entry) =>
      entry.kind === "chat_question" || entry.kind === "focus_update",
  );
  const wmUserAction = wmRecent.some(
    (entry) => entry.kind === "user_action",
  );
  const wmWindowSwitch = wmRecent.some(
    (entry) => entry.kind === "window_switch",
  );
  if (wmChatOrFocus) {
    score += 2;
    reasons.push("недавний вопрос или смена фокуса в кратковременной памяти");
    const wmTopic = wmRecent.find(
      (entry) =>
        entry.kind === "chat_question" || entry.kind === "focus_update",
    )?.topic;
    subjectKey = subjectKey ?? wmTopic?.slice(0, 80);
  } else if (wmUserAction) {
    score += 2;
    reasons.push("недавнее действие в кратковременной памяти");
    subjectKey =
      subjectKey ??
      wmRecent.find((entry) => entry.kind === "user_action")?.topic?.slice(
        0,
        80,
      );
  } else if (wmWindowSwitch) {
    score += 1;
    reasons.push("недавняя активность в кратковременной памяти");
  }

  if (sessionMinutes >= 5 && bundle.editorFile && score === 0) {
    score += 1;
    reasons.push(`live IDE context: ${bundle.editorFile}`);
    subjectKey = subjectKey ?? bundle.editorFile;
  }

  const workContext = isProactiveWorkContext({ bundle, sessionMinutes });
  const hasWorkEvidence = Boolean(
    bundle.editorFile ||
      bundle.visionSummary ||
      bundle.clipboardSnippets.length ||
      bundle.taskActivityLink ||
      bundle.nextTaskTitle ||
      bundle.focusStep ||
      bundle.focusBlockers.length ||
      bundle.advisor.topQueryThemes.length ||
      screenState.confidence >= 0.45,
  );
  if (
    settings.initiativeLevel === "active" &&
    workContext &&
    hasWorkEvidence &&
    sessionMinutes >= 5
  ) {
    score += 3;
    reasons.push(
      bundle.editorFile
        ? `активный режим: рабочий контекст ${bundle.editorFile}`
        : "активный режим: есть рабочий контекст",
    );
    subjectKey =
      subjectKey ??
      bundle.editorFile ??
      screenState.visibleEntities[0] ??
      bundle.window?.title?.slice(0, 80);
  } else if (workContext && hasWorkEvidence && sessionMinutes >= 12) {
    score += 1;
    reasons.push("долгая работа с видимым контекстом");
    subjectKey =
      subjectKey ??
      bundle.editorFile ??
      screenState.visibleEntities[0] ??
      bundle.window?.title?.slice(0, 80);
  }

  if (
    workContext &&
    sessionMinutes >= 5 &&
    (bundle.editorFile || bundle.advisor.dominantFile) &&
    score < 1
  ) {
    score = 1;
    reasons.push(
      bundle.editorFile
        ? `устойчивая работа в ${bundle.editorFile}`
        : `устойчивая работа в ${bundle.advisor.dominantFile}`,
    );
    subjectKey =
      subjectKey ?? bundle.editorFile ?? bundle.advisor.dominantFile;
  }

  const hasRecentActivitySignal =
    wmRecent.length > 0 ||
    bundle.advisor.activitySummary.recentSignals.some(
      (entry) => now - entry.at <= WM_RECENT_MS,
    );

  let level: AdviceUrgencyLevel = "none";
  let effectiveIntervalMs = userIntervalMs;

  if (score >= 6) {
    level = "high";
    effectiveIntervalMs = URGENT_ADVICE_MIN_MS;
  } else if (score >= 3) {
    level = "medium";
    effectiveIntervalMs = Math.min(userIntervalMs, MEDIUM_ADVICE_CAP_MS);
  } else if (score >= 1 && (workContext || hasRecentActivitySignal)) {
    level = "low";
    effectiveIntervalMs =
      workContext && sessionMinutes >= 5 && bundle.editorFile
        ? Math.min(userIntervalMs, MEDIUM_ADVICE_CAP_MS)
        : userIntervalMs;
  }

  return {
    level,
    score,
    reasons,
    effectiveIntervalMs,
    subjectKey,
  };
}

export function shouldOfferLlmAdvice(urgency: AdviceUrgency): boolean {
  return urgency.level !== "none";
}

function bypassesLowUrgencyAdviceCap(urgency: AdviceUrgency): boolean {
  return urgency.reasons.some((reason) =>
    /свеж(ий|ая) буфер|фрагмент кода|ошибка в буфере|недавнее действие|недавний вопрос|смена фокуса|актуальный поиск/i.test(
      reason,
    ),
  );
}

export function getAdviceReadinessBlockReason(
  urgency: AdviceUrgency,
  sinceAdviceAttemptMs: number,
  now = Date.now(),
  adviceIntervalMs = urgency.effectiveIntervalMs,
): string | null {
  if (!shouldOfferLlmAdvice(urgency)) {
    return "срочность none";
  }
  const effectiveIntervalMs = Math.min(adviceIntervalMs, urgency.effectiveIntervalMs);
  if (sinceAdviceAttemptMs < effectiveIntervalMs) {
    const recentSentAdvice = countRecentAdviceByTone(
      "advice",
      now - effectiveIntervalMs,
      now,
    );
    if (recentSentAdvice > 0) {
      const waitSec = Math.ceil(
        (effectiveIntervalMs - sinceAdviceAttemptMs) / 1000,
      );
      return `интервал совета (~${waitSec} с)`;
    }
  }
  if (urgency.level === "low") {
    const recentAdvice = countRecentAdviceByTone(
      "advice",
      now - 25 * 60_000,
      now,
    );
    if (recentAdvice >= 1 && !bypassesLowUrgencyAdviceCap(urgency)) {
      return "low: уже был совет за 25 мин";
    }
  }
  if (urgency.level !== "high") {
    if (countRecentAdviceStreak(now) >= 2) {
      return "серия из 2+ советов подряд";
    }
    if (isAdviceSkewedToday(getProactiveToneSnapshot(now))) {
      return "перекос в сторону советов сегодня";
    }
  }
  if (
    urgency.subjectKey &&
    isAdviceSubjectRecentlyAdvised(
      urgency.subjectKey,
      effectiveIntervalMs,
      now,
    ) &&
    !bypassesLowUrgencyAdviceCap(urgency)
  ) {
    return "тот же якорь недавно советовали";
  }
  return null;
}

export type CadencePressureLevel = "none" | "low" | "medium" | "high";

export function computeCadencePressure(
  urgency: AdviceUrgency,
  sinceAdviceAttemptMs: number,
  now = Date.now(),
  adviceIntervalMs = urgency.effectiveIntervalMs,
): { level: CadencePressureLevel; reasons: string[] } {
  const reasons: string[] = [];
  if (!shouldOfferLlmAdvice(urgency)) {
    return { level: "none", reasons };
  }

  const blockReason = getAdviceReadinessBlockReason(
    urgency,
    sinceAdviceAttemptMs,
    now,
    adviceIntervalMs,
  );
  if (!blockReason) {
    return { level: "none", reasons };
  }
  reasons.push(blockReason);

  if (
    blockReason.includes("серия") ||
    blockReason.includes("якорь") ||
    blockReason.includes("перекос")
  ) {
    return { level: "high", reasons };
  }
  if (blockReason.includes("25 мин")) {
    return { level: "medium", reasons };
  }
  if (blockReason.includes("интервал")) {
    return { level: "low", reasons };
  }
  return { level: "medium", reasons };
}

export function isAdviceReady(
  urgency: AdviceUrgency,
  sinceAdviceAttemptMs: number,
  now = Date.now(),
  adviceIntervalMs = urgency.effectiveIntervalMs,
): boolean {
  return (
    getAdviceReadinessBlockReason(
      urgency,
      sinceAdviceAttemptMs,
      now,
      adviceIntervalMs,
    ) === null
  );
}

export type AdviceReadinessSnapshot = {
  ready: boolean;
  label: string;
  blockReason: string | null;
  intervalWaitSec: number;
};

export function describeAdviceReadiness(
  urgency: AdviceUrgency | null,
  options: {
    advisorEnabled: boolean;
    llmOnline: boolean;
    sinceAdviceAttemptMs: number;
    adviceIntervalMs: number;
    now?: number;
  },
): AdviceReadinessSnapshot {
  const now = options.now ?? Date.now();
  const intervalWaitSec = Math.max(
    0,
    Math.ceil((options.adviceIntervalMs - options.sinceAdviceAttemptMs) / 1000),
  );

  if (!options.advisorEnabled) {
    return {
      ready: false,
      label: "советник выкл",
      blockReason: "советник выкл",
      intervalWaitSec,
    };
  }
  if (!options.llmOnline) {
    return {
      ready: false,
      label: "llm offline",
      blockReason: "llm offline",
      intervalWaitSec,
    };
  }
  if (!urgency || urgency.level === "none") {
    return {
      ready: false,
      label: "нет срочности",
      blockReason: "срочность none",
      intervalWaitSec,
    };
  }

  const blockReason = getAdviceReadinessBlockReason(
    urgency,
    options.sinceAdviceAttemptMs,
    now,
    options.adviceIntervalMs,
  );
  if (blockReason) {
    return {
      ready: false,
      label: blockReason,
      blockReason,
      intervalWaitSec,
    };
  }
  if (intervalWaitSec > 0) {
    return {
      ready: false,
      label: `~${intervalWaitSec} с (интервал)`,
      blockReason: "ждёт интервал",
      intervalWaitSec,
    };
  }
  return {
    ready: true,
    label: "готов",
    blockReason: null,
    intervalWaitSec: 0,
  };
}

export function planSignalDrivenAdvice(
  bundle: InitiativeSignalBundle,
  urgency: AdviceUrgency,
  banned: string[] = collectBannedProactiveTopics(),
): SignalDrivenAdvicePlan {
  const advisorCtx = bundle.advisor;
  let angle = selectAdvisorAngle(advisorCtx);
  if (!angle && urgency.level !== "none") {
    angle = advisorAngleForAdviceSignals(bundle);
  }

  const kind = angle
    ? initiativeKindForAngle(angle, bundle)
    : "process_advice";

  const seen = new Set<string>();
  const conversationTopics: string[] = [];
  const pushTopic = (topic?: string) => {
    const trimmed = topic?.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    conversationTopics.push(trimmed);
  };

  pushTopic(buildLiveCodingTopic(bundle));
  for (const topic of buildConversationTopics(advisorCtx, 5, banned, bundle)) {
    pushTopic(topic);
  }
  for (const topic of buildFallbackInitiativeTopics(bundle, banned)) {
    pushTopic(topic);
  }

  const anchor =
    pickPlannedInitiativeAnchor(conversationTopics, {
      recentProactive: banned,
      windowTitle: bundle.window?.title,
      dominantFile: bundle.editorFile,
    }) ?? buildLiveCodingTopic(bundle);

  return {
    kind,
    angle: angle ?? undefined,
    conversationTopics: conversationTopics.slice(0, 5),
    anchor,
  };
}
