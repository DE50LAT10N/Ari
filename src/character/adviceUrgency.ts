import type { AppSettings } from "../settings/appSettings";
import type { InitiativeSignalBundle } from "./initiativeContext";
import { collectBannedProactiveTopics } from "./initiativeContext";
import {
  MEDIUM_ADVICE_CAP_MS,
  proactiveIntervalMs,
  URGENT_ADVICE_MIN_MS,
} from "./initiativeConfig";
import type { InitiativeKind } from "./initiativeKinds";
import { isAdviceSubjectRecentlyAdvised } from "./proactiveState";
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
    options.userIntervalMs ?? proactiveIntervalMs(settings);
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

  const codeClip = freshClipboard.find((clip) => clip.kind === "code");
  if (codeClip && !stack) {
    score += 2;
    reasons.push("фрагмент кода в буфере");
    subjectKey = subjectKey ?? codeClip.text.slice(0, 60);
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

  if (sessionMinutes >= 3 && bundle.editorFile) {
    score += 1;
    reasons.push(`работа в ${bundle.editorFile}`);
    subjectKey = subjectKey ?? bundle.editorFile;
  }

  const wmRecent = pruneWorkingMemory(now).filter(
    (entry) => now - entry.at <= WM_RECENT_MS,
  );
  if (
    wmRecent.some(
      (entry) =>
        entry.kind === "chat_question" || entry.kind === "window_switch",
    )
  ) {
    score += 1;
    reasons.push("недавняя активность в кратковременной памяти");
  }

  const workContext = isProactiveWorkContext({ bundle, sessionMinutes });
  let level: AdviceUrgencyLevel = "none";
  let effectiveIntervalMs = userIntervalMs;

  if (score >= 6) {
    level = "high";
    effectiveIntervalMs = URGENT_ADVICE_MIN_MS;
  } else if (score >= 3) {
    level = "medium";
    effectiveIntervalMs = Math.min(userIntervalMs, MEDIUM_ADVICE_CAP_MS);
  } else if (score >= 1 && workContext) {
    level = "low";
    effectiveIntervalMs = userIntervalMs;
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

export function isAdviceReady(
  urgency: AdviceUrgency,
  sinceLastAttemptMs: number,
  now = Date.now(),
): boolean {
  if (!shouldOfferLlmAdvice(urgency)) {
    return false;
  }
  if (sinceLastAttemptMs < urgency.effectiveIntervalMs) {
    return false;
  }
  if (
    urgency.subjectKey &&
    isAdviceSubjectRecentlyAdvised(
      urgency.subjectKey,
      urgency.effectiveIntervalMs,
      now,
    )
  ) {
    return false;
  }
  return true;
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
