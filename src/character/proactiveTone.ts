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

export function isPracticalAnchor(anchor?: string): boolean {
  if (!anchor?.trim()) {
    return false;
  }
  const lower = anchor.toLowerCase();
  if (DEBUG_ANCHOR_HINTS.some((hint) => lower.includes(hint))) {
    return true;
  }
  return /\.[a-z0-9]{1,6}\b/i.test(anchor);
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

function isAdviceAngle(angle?: AdvisorAngle): boolean {
  return angle === "debug_help" || angle === "refocus" || angle === "scope";
}

function isSocialTopicLabel(topic: string): boolean {
  const lower = topic.toLowerCase();
  return (
    lower.includes("как прошло") ||
    lower.includes("как дела") ||
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
  llmTone?: ProactiveReplyTone;
}): ProactiveReplyTone {
  if (input.llmTone) {
    return input.llmTone;
  }

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
      if (isPracticalAnchor(anchor)) {
        return "advice";
      }
      if (bundle && hasTechnicalAdvisorSignals(bundle)) {
        return "advice";
      }
      return "smalltalk";
    case "check_in":
      if (
        isSocialOnlyTopics(conversationTopics) &&
        (!bundle || !hasTechnicalAdvisorSignals(bundle)) &&
        !isPracticalAnchor(anchor)
      ) {
        return "smalltalk";
      }
      if (isPracticalAnchor(anchor)) {
        return "advice";
      }
      if (bundle && isProactiveWorkContext({ bundle })) {
        if (!isSocialOnlyTopics(conversationTopics)) {
          return "advice";
        }
        const liveCodingFile =
          bundle.editorFile ?? bundle.advisor.editorContext.file;
        const inCodingWindow =
          Boolean(bundle.window) &&
          CODING_PROCESS_PATTERN.test(bundle.window!.processName);
        if (liveCodingFile && inCodingWindow) {
          return "advice";
        }
      }
      if (bundle && hasTechnicalAdvisorSignals(bundle)) {
        if (!isSocialOnlyTopics(conversationTopics)) {
          return "advice";
        }
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
): boolean {
  if (!settings.webToolsEnabled || tone !== "advice") {
    return false;
  }
  if (hasProactiveDebugSignals(bundle)) {
    return true;
  }
  if (anchor && isPracticalAnchor(anchor)) {
    return DEBUG_ANCHOR_HINTS.some((hint) =>
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
