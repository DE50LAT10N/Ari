import type { AdviceUrgencyLevel } from "./adviceUrgency";
import type { AppSettings } from "../settings/appSettings";
import type { AdvisorAngle } from "./advisorEngine";
import type { InitiativeKind } from "./initiativeKinds";
import type { InitiativeSignalBundle } from "./initiativeContext";

export type ProactiveReplyTone = "advice" | "smalltalk";

const CODING_PROCESS_PATTERN =
  /(?:code|cursor|devenv|idea|rider|pycharm|webstorm|vim|neovim|sublime|electron|windows terminal|wt\.exe)/i;

const CODING_WINDOW_TITLE_PATTERN =
  /(?:\.tsx?|\.jsx?|\.rs|\.py|\.go|\.java|\.cs|\.cpp|visual studio|vscode|git|docker|compile|build|debug|npm|cargo|webpack|vite|tauri|node\.js|typescript|rust)/i;

const DEBUG_ANCHOR_HINTS = [
  "отлад",
  "ошибк",
  "stack",
  "буфер",
  "блокер",
  "debug",
  "trace",
];

const RESEARCHABLE_ANCHOR_HINTS = [
  ...DEBUG_ANCHOR_HINTS,
  "api",
  "config",
  "library",
  "докумен",
  "версия",
  "version",
  "npm",
  "cargo",
  "typescript",
  "react",
  "как ",
  "how to",
  "fix",
  "install",
];

const RESEARCHABLE_CANDIDATE_KINDS = new Set([
  "docs_lookup",
  "solution_lookup",
  "debug_next_step",
  "terminal_error_triage",
  "test_failure_triage",
  "docs_to_code_bridge",
]);

export function isPracticalAnchor(anchor?: string): boolean {
  if (!anchor?.trim()) {
    return false;
  }
  const lower = anchor.toLowerCase();
  if (RESEARCHABLE_ANCHOR_HINTS.some((hint) => lower.includes(hint))) {
    return true;
  }
  return /\.[a-z0-9]{1,6}\b/i.test(anchor);
}

export function isResearchableAdviceTopic(
  anchor?: string,
  candidateKind?: string,
): boolean {
  if (candidateKind && RESEARCHABLE_CANDIDATE_KINDS.has(candidateKind)) {
    return true;
  }
  if (!anchor?.trim()) {
    return false;
  }
  const lower = anchor.toLowerCase();
  return RESEARCHABLE_ANCHOR_HINTS.some((hint) => lower.includes(hint));
}

export function isProactiveWorkContext(input: {
  bundle: InitiativeSignalBundle;
  sessionMinutes?: number;
}): boolean {
  const { bundle, sessionMinutes = 0 } = input;
  if (
    bundle.editorFile ||
    bundle.projectContext ||
    bundle.focusStep ||
    bundle.focusBlockers.length > 0 ||
    bundle.taskActivityLink ||
    bundle.nextTaskTitle
  ) {
    return true;
  }
  if (hasTechnicalAdvisorSignals(bundle)) {
    return true;
  }
  const window = bundle.window;
  if (window) {
    const codingWindow =
      CODING_PROCESS_PATTERN.test(window.processName) ||
      CODING_WINDOW_TITLE_PATTERN.test(window.title);
    const ideMinutesThreshold = bundle.editorFile ? 1 : 3;
    if (codingWindow && sessionMinutes >= ideMinutesThreshold) {
      return true;
    }
  }
  if (sessionMinutes >= 10 && Boolean(bundle.advisor.dominantFile)) {
    return true;
  }
  return false;
}

function hasTechnicalAdvisorSignals(bundle: InitiativeSignalBundle): boolean {
  const { advisor } = bundle;
  return (
    Boolean(advisor.repeatedErrorSignature) ||
    advisor.stuckScore >= 0.45 ||
    Boolean(advisor.dominantFile) ||
    bundle.clipboardSnippets.some((clip) => clip.kind === "stacktrace") ||
    bundle.focusBlockers.length > 0
  );
}

/** Strong signals for flipping check-in to advice — dominant file alone is not enough. */
export function hasUrgentAdvisorSignals(bundle: InitiativeSignalBundle): boolean {
  const { advisor } = bundle;
  return (
    Boolean(advisor.repeatedErrorSignature) ||
    advisor.stuckScore >= 0.45 ||
    bundle.clipboardSnippets.some((clip) => clip.kind === "stacktrace") ||
    bundle.focusBlockers.length > 0
  );
}

const SMALLTALK_ONLY_KINDS = new Set<InitiativeKind>([
  "memory_callback",
  "return_reaction",
  "context_comment",
  "quiet_presence",
]);

const ADVICE_ONLY_KINDS = new Set<InitiativeKind>([
  "process_advice",
  "screen_glance",
  "break_suggestion",
  "distraction_nudge",
]);

export function resolveProactiveReplyTone(input: {
  initiativeKind: InitiativeKind;
  advisorAngle?: AdvisorAngle;
  anchor?: string;
  bundle?: InitiativeSignalBundle;
  conversationTopics?: string[];
  urgencyLevel?: AdviceUrgencyLevel;
  llmTone?: ProactiveReplyTone;
}): ProactiveReplyTone {
  if (SMALLTALK_ONLY_KINDS.has(input.initiativeKind)) {
    return "smalltalk";
  }
  if (ADVICE_ONLY_KINDS.has(input.initiativeKind)) {
    return "advice";
  }

  const classified = classifyProactiveReplyTone({
    initiativeKind: input.initiativeKind,
    advisorAngle: input.advisorAngle,
    anchor: input.anchor,
    bundle: input.bundle,
    conversationTopics: input.conversationTopics,
    urgencyLevel: input.urgencyLevel,
  });

  if (classified === "smalltalk") {
    return "smalltalk";
  }
  return input.llmTone === "advice" ? "advice" : classified;
}

function isAdviceAngle(angle?: AdvisorAngle): boolean {
  return angle === "debug_help" || angle === "refocus" || angle === "scope";
}

function isSocialTopicLabel(topic: string): boolean {
  const lower = topic.toLowerCase();
  if (/\.(?:tsx?|jsx?|rs|py|go|java|cs|cpp)\b/i.test(topic)) {
    return false;
  }
  return (
    lower.includes("как прошло") ||
    lower.includes("как дела") ||
    lower.includes("как идёт") ||
    lower.includes("как идет") ||
    lower.includes("что делаешь") ||
    lower.includes("устал") ||
    lower.includes("устала") ||
    lower.includes("скучно") ||
    lower.includes("помнишь") ||
    lower.includes("вернул")
  );
}

function isSocialOnlyTopics(conversationTopics?: string[]): boolean {
  return Boolean(
    conversationTopics?.length &&
      conversationTopics.every((topic) => isSocialTopicLabel(topic)),
  );
}

export function classifyProactiveReplyTone(input: {
  initiativeKind: InitiativeKind;
  advisorAngle?: AdvisorAngle;
  anchor?: string;
  bundle?: InitiativeSignalBundle;
  conversationTopics?: string[];
  urgencyLevel?: AdviceUrgencyLevel;
}): ProactiveReplyTone {
  const { initiativeKind, advisorAngle, anchor, bundle, conversationTopics } =
    input;

  if (isAdviceAngle(advisorAngle)) {
    return "advice";
  }

  switch (initiativeKind) {
    case "process_advice":
    case "screen_glance":
    case "break_suggestion":
    case "distraction_nudge":
      return "advice";
    case "memory_callback":
    case "return_reaction":
    case "context_comment":
    case "quiet_presence":
      return "smalltalk";
    case "unfinished_thread":
      if (isPracticalAnchor(anchor) && bundle && hasUrgentAdvisorSignals(bundle)) {
        return "advice";
      }
      return "smalltalk";
    case "check_in":
      if (
        isSocialOnlyTopics(conversationTopics) &&
        (!bundle || !hasUrgentAdvisorSignals(bundle)) &&
        !isPracticalAnchor(anchor)
      ) {
        return "smalltalk";
      }
      if (
        input.urgencyLevel === "high" &&
        bundle &&
        hasUrgentAdvisorSignals(bundle)
      ) {
        return "advice";
      }
      if (
        input.urgencyLevel === "medium" &&
        bundle &&
        hasUrgentAdvisorSignals(bundle) &&
        (isPracticalAnchor(anchor) || !isSocialOnlyTopics(conversationTopics))
      ) {
        return "advice";
      }
      if (
        isPracticalAnchor(anchor) &&
        bundle &&
        hasUrgentAdvisorSignals(bundle)
      ) {
        return "advice";
      }
      return "smalltalk";
    default:
      return "smalltalk";
  }
}

export function hasProactiveDebugSignals(
  bundle: InitiativeSignalBundle,
): boolean {
  const { advisor } = bundle;
  return (
    Boolean(advisor.repeatedErrorSignature) ||
    advisor.stuckScore >= 0.45 ||
    bundle.clipboardSnippets.some((clip) => clip.kind === "stacktrace") ||
    bundle.focusBlockers.length > 0
  );
}

export function shouldProactiveWebSearch(
  bundle: InitiativeSignalBundle,
  tone: ProactiveReplyTone,
  settings: Pick<AppSettings, "webToolsEnabled">,
  anchor?: string,
  candidateKind?: string,
): boolean {
  if (!settings.webToolsEnabled || tone !== "advice") {
    return false;
  }
  if (hasProactiveDebugSignals(bundle)) {
    return true;
  }
  if (isResearchableAdviceTopic(anchor, candidateKind)) {
    return true;
  }
  if (bundle.advisor.topQueryThemes.length > 0) {
    return true;
  }
  if (anchor && isPracticalAnchor(anchor)) {
    return RESEARCHABLE_ANCHOR_HINTS.some((hint) =>
      anchor.toLowerCase().includes(hint),
    );
  }
  return bundle.clipboardSnippets.some(
    (clip) => clip.kind === "stacktrace" || clip.kind === "code",
  );
}

function latestStacktraceSnippet(
  bundle: InitiativeSignalBundle,
): string | undefined {
  const stack = [...bundle.clipboardSnippets]
    .reverse()
    .find((clip) => clip.kind === "stacktrace");
  return stack?.text.trim();
}

function latestBrowserTheme(bundle: InitiativeSignalBundle): string | undefined {
  for (const entry of bundle.advisor.activitySummary.recentSignals
    .slice()
    .reverse()) {
    if (entry.kind === "query_topic" && entry.source === "browser") {
      return entry.topic;
    }
  }
  return bundle.advisor.topQueryThemes[0];
}

export function buildProactiveWebSearchQuery(
  bundle: InitiativeSignalBundle,
  anchor?: string,
): string {
  const parts: string[] = [];
  const signature = bundle.advisor.repeatedErrorSignature?.trim();
  if (signature) {
    parts.push(signature.slice(0, 80));
  }
  const stack = latestStacktraceSnippet(bundle);
  if (stack) {
    const firstLine = stack.split(/\r?\n/).find((line) => line.trim()) ?? stack;
    parts.push(firstLine.slice(0, 100));
  }
  if (bundle.advisor.dominantFile && /\.[a-z0-9]{1,6}$/i.test(bundle.advisor.dominantFile)) {
    parts.push(bundle.advisor.dominantFile);
  }
  if (
    bundle.advisor.activitySummary.inputFrictionScore >= 1 &&
    (bundle.editorFile || bundle.advisor.dominantFile)
  ) {
    parts.push(
      `${bundle.editorFile ?? bundle.advisor.dominantFile} stuck debugging likely cause fix`,
    );
  }
  const browserTheme = latestBrowserTheme(bundle);
  if (browserTheme) {
    parts.push(browserTheme.slice(0, 80));
  }
  if (!parts.length && anchor && isPracticalAnchor(anchor)) {
    parts.push(anchor.slice(0, 100));
  }
  if (!parts.length && bundle.focusBlockers[0]) {
    parts.push(bundle.focusBlockers[0].slice(0, 100));
  }

  const query = [...new Set(parts.filter(Boolean))].join(" ").trim();
  return query.slice(0, 120) || "debug error fix";
}

export function advisorAngleForAdviceSignals(
  bundle: InitiativeSignalBundle,
): AdvisorAngle {
  const { advisor } = bundle;
  if (
    advisor.repeatedErrorSignature ||
    advisor.stuckScore >= 0.45 ||
    bundle.clipboardSnippets.some((clip) => clip.kind === "stacktrace")
  ) {
    return "debug_help";
  }
  if (advisor.contextThrash) {
    return "refocus";
  }
  if (advisor.scopeCreep) {
    return "scope";
  }
  return "debug_help";
}

export function isTopicAngleTechnical(
  ctx: InitiativeSignalBundle["advisor"],
  bundle: InitiativeSignalBundle,
): boolean {
  return (
    hasTechnicalAdvisorSignals(bundle) ||
    Boolean(ctx.dominantFile) ||
    ctx.topQueryThemes.length > 0
  );
}
