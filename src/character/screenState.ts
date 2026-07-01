import type { InitiativeSignalBundle } from "./initiativeContext";

export type ScreenAppKind =
  | "ide"
  | "terminal"
  | "browser"
  | "communication"
  | "other";

export type ScreenState = {
  app: ScreenAppKind;
  visibleEntities: string[];
  visibleProblem?: string;
  visibleCodeContext?: {
    file?: string;
    repo?: string;
    errorHints: string[];
  };
  userLikelyDoing: string;
  confidence: number;
  evidence: string[];
};

const TERMINAL_PROCESS = /(?:terminal|powershell|cmd|wt\.exe|wezterm|alacritty|iterm)/i;
const BROWSER_PROCESS = /(?:chrome|firefox|edge|msedge|brave|opera|vivaldi|browser)/i;
const IDE_PROCESS = /(?:cursor|code|devenv|idea|rider|pycharm|webstorm|rustrover|zed|vim|neovim|sublime)/i;
const COMM_PROCESS = /(?:slack|teams|telegram|discord|zoom|outlook|mail)/i;
const ERROR_HINT = /(?:error|exception|traceback|panic|failed|fail|ошиб|stack|assert|cannot|undefined|null)/i;
const TEST_HINT = /(?:test|spec|vitest|jest|pytest|cargo test|assert|expected|received|failed)/i;

function classifyApp(processName = "", title = ""): ScreenAppKind {
  const haystack = `${processName} ${title}`;
  if (TERMINAL_PROCESS.test(haystack)) return "terminal";
  if (IDE_PROCESS.test(haystack)) return "ide";
  if (BROWSER_PROCESS.test(haystack)) return "browser";
  if (COMM_PROCESS.test(haystack)) return "communication";
  return "other";
}

function pushUnique(values: string[], value?: string): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const normalized = trimmed.toLowerCase();
  if (!values.some((entry) => entry.toLowerCase() === normalized)) {
    values.push(trimmed.slice(0, 140));
  }
}

function latestProblemText(bundle: InitiativeSignalBundle): string | undefined {
  const stack = [...bundle.clipboardSnippets]
    .reverse()
    .find((clip) => clip.kind === "stacktrace");
  if (stack) {
    return stack.text.slice(0, 180);
  }
  const repeated = bundle.advisor.repeatedErrorSignature;
  if (repeated) {
    return repeated.slice(0, 180);
  }
  if (bundle.visionSummary && ERROR_HINT.test(bundle.visionSummary)) {
    return bundle.visionSummary.slice(0, 180);
  }
  const title = bundle.window?.title;
  if (title && ERROR_HINT.test(title)) {
    return title.slice(0, 160);
  }
  return undefined;
}

function collectErrorHints(bundle: InitiativeSignalBundle): string[] {
  const hints: string[] = [];
  for (const clip of bundle.clipboardSnippets) {
    if (clip.kind === "stacktrace" || ERROR_HINT.test(clip.text)) {
      pushUnique(hints, clip.text.split(/\r?\n/).find((line) => ERROR_HINT.test(line)) ?? clip.text);
    }
  }
  pushUnique(hints, bundle.advisor.repeatedErrorSignature);
  if (bundle.visionSummary && ERROR_HINT.test(bundle.visionSummary)) {
    pushUnique(hints, bundle.visionSummary);
  }
  return hints.slice(0, 3);
}

export function deriveScreenState(bundle: InitiativeSignalBundle): ScreenState {
  const processName = bundle.window?.processName ?? bundle.advisor.currentProcess;
  const title = bundle.window?.title ?? bundle.advisor.currentTitle;
  const app = classifyApp(processName, title);
  const entities: string[] = [];
  const evidence: string[] = [];
  const errorHints = collectErrorHints(bundle);
  const visibleProblem = latestProblemText(bundle);

  pushUnique(entities, bundle.editorFile);
  pushUnique(entities, bundle.editorRepo);
  pushUnique(entities, bundle.taskActivityLink?.taskTitle);
  pushUnique(entities, bundle.nextTaskTitle);
  for (const theme of bundle.advisor.recentCompletions.slice(0, 1)) {
    pushUnique(entities, theme);
  }
  for (const theme of bundle.advisor.activitySummary.recentQueryTopics.slice(0, 2)) {
    pushUnique(entities, theme);
  }

  if (bundle.editorFile) evidence.push(`file:${bundle.editorFile}`);
  if (bundle.window?.title) evidence.push(`window:${bundle.window.title.slice(0, 80)}`);
  if (bundle.visionSummary) evidence.push(`vision:${bundle.visionSummary.slice(0, 100)}`);
  if (bundle.clipboardSnippets.length) {
    evidence.push(
      `clipboard:${bundle.clipboardSnippets
        .slice(-2)
        .map((clip) => clip.kind)
        .join(",")}`,
    );
  }
  if (visibleProblem) evidence.push(`problem:${visibleProblem.slice(0, 100)}`);

  const docsTheme = bundle.advisor.activitySummary.recentQueryTopics[0];
  let userLikelyDoing = "ориентируется в текущем окне";
  if (visibleProblem) {
    userLikelyDoing = TEST_HINT.test(visibleProblem)
      ? "разбирает падение теста или проверку"
      : "отлаживает ошибку";
  } else if (bundle.editorFile && docsTheme) {
    userLikelyDoing = "связывает документацию или поиск с кодом";
  } else if (bundle.editorFile) {
    userLikelyDoing = "работает в файле";
  } else if (app === "browser" && docsTheme) {
    userLikelyDoing = "ищет информацию в браузере";
  } else if (bundle.taskActivityLink?.taskTitle) {
    userLikelyDoing = "двигает задачу";
  }

  const confidence = Math.min(
    0.95,
    0.25 +
      (bundle.editorFile ? 0.2 : 0) +
      (visibleProblem ? 0.24 : 0) +
      (bundle.visionSummary ? 0.14 : 0) +
      (bundle.clipboardSnippets.length ? 0.12 : 0) +
      (docsTheme ? 0.1 : 0) +
      (bundle.taskActivityLink ? 0.1 : 0),
  );

  return {
    app,
    visibleEntities: entities.slice(0, 6),
    visibleProblem,
    visibleCodeContext:
      bundle.editorFile || bundle.editorRepo || errorHints.length
        ? {
            file: bundle.editorFile,
            repo: bundle.editorRepo,
            errorHints,
          }
        : undefined,
    userLikelyDoing,
    confidence,
    evidence,
  };
}

export function describeScreenState(state: ScreenState): string {
  return [
    `app=${state.app}`,
    state.visibleCodeContext?.file ? `file=${state.visibleCodeContext.file}` : "",
    state.visibleProblem ? `problem=${state.visibleProblem}` : "",
    state.visibleEntities.length ? `entities=${state.visibleEntities.join(" | ")}` : "",
    `likely=${state.userLikelyDoing}`,
    `confidence=${state.confidence.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function screenStateHasTestFailure(state: ScreenState): boolean {
  return Boolean(
    state.visibleProblem &&
      TEST_HINT.test(
        `${state.visibleProblem} ${state.visibleCodeContext?.errorHints.join(" ") ?? ""}`,
      ),
  );
}
