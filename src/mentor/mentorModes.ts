export type MentorMode =
  | "project_understanding"
  | "mentor_explain"
  | "mentor_review"
  | "mentor_debug"
  | "mentor_architecture"
  | "mentor_learning"
  | "implementation";

export type MentorAuthorization = {
  readProjectFiles: boolean;
  readUnsavedBuffers: boolean;
  readDiagnostics: boolean;
  suggestChanges: boolean;
  editFiles: boolean;
  runCommands: boolean;
  useNetwork: boolean;
};

export type MentorTask = {
  mode: MentorMode;
  goal: string;
  authorization: MentorAuthorization;
  requestedDepth: "concise" | "normal" | "deep";
  output: "explanation" | "review" | "alternatives" | "plan" | "patch";
};

export const READ_ONLY_MENTOR_AUTHORIZATION: MentorAuthorization = {
  readProjectFiles: true,
  readUnsavedBuffers: false,
  readDiagnostics: true,
  suggestChanges: true,
  editFiles: false,
  runCommands: false,
  useNetwork: false,
};

const ENGINEERING_MARKERS =
  /(?:\b(?:code|coding|bug|debug|error|exception|stack\s*trace|test|lint|build|compile|refactor|review|architecture|dependency|function|class|api|typescript|javascript|react|rust|tauri|python|java|kotlin|git|repository|project)\b|код|ошибк|баг|отлад|тест|сборк|компил|рефактор|ревью|архитектур|зависимост|функци|класс|репозитор|проект)/i;

export function isEngineeringRequest(message: string): boolean {
  return ENGINEERING_MARKERS.test(message.trim());
}

export function classifyMentorMode(message: string): MentorMode {
  const normalized = message.trim().toLowerCase();

  if (/(?:code review|review this|ревью|проверь код|найди проблем|оцени код)/i.test(normalized)) {
    return "mentor_review";
  }
  if (/(?:debug|bug|stack trace|exception|не работает|ошибк|падает|сломал|почини|отлад)/i.test(normalized)) {
    return "mentor_debug";
  }
  if (/(?:architect|design|модул|сло[йя]|масштаб|архитектур|trade.?off|вариант реализации)/i.test(normalized)) {
    return "mentor_architecture";
  }
  if (/(?:объясни (?:структуру )?проекта?|разберись в проект|карта проекта|структура проекта|understand (?:the )?project|project overview|как устроен проект)/i.test(normalized)) {
    return "project_understanding";
  }
  if (/(?:научи|обуч|пошагово со мной|не давай готовый ответ|задай упражнение|learning mode|teach me)/i.test(normalized)) {
    return "mentor_learning";
  }
  if (/(?:реализуй|внеси изменения|измени файл|напиши код|сделай патч|implement|edit (?:the )?file|apply (?:the )?patch)/i.test(normalized)) {
    return "implementation";
  }
  return "mentor_explain";
}

function requestedDepth(message: string): MentorTask["requestedDepth"] {
  if (/(?:подробно|глубоко|детально|deep|in detail)/i.test(message)) {
    return "deep";
  }
  if (/(?:кратко|коротко|concise|briefly)/i.test(message)) {
    return "concise";
  }
  return "normal";
}

function outputForMode(mode: MentorMode): MentorTask["output"] {
  switch (mode) {
    case "mentor_review":
      return "review";
    case "mentor_architecture":
      return "alternatives";
    case "project_understanding":
      return "plan";
    case "implementation":
      return "patch";
    default:
      return "explanation";
  }
}

export function createMentorTask(
  message: string,
  authorization: Partial<MentorAuthorization> = {},
): MentorTask {
  const mode = classifyMentorMode(message);
  return {
    mode,
    goal: message.trim().slice(0, 4_000),
    requestedDepth: requestedDepth(message),
    output: outputForMode(mode),
    authorization: {
      ...READ_ONLY_MENTOR_AUTHORIZATION,
      ...authorization,
    },
  };
}

export function buildMentorModePolicy(task: MentorTask): string {
  const base = [
    `Engineering Mentor mode: ${task.mode}.`,
    "Separate observed facts, inferences, and unknowns.",
    "Use only the supplied project/IDE evidence and cite source IDs or file:line when available.",
    "Explain the root cause and recommend the smallest verifiable next step.",
    "Do not claim that a change, command, or test succeeded without a tool result.",
  ];

  const modePolicy: Record<MentorMode, string> = {
    project_understanding:
      "Map entry points, modules, dependencies, data flow, risks, and unknowns before recommending changes.",
    mentor_explain:
      "Teach the concept at the user's level; prefer explanation and a small example over a full replacement implementation.",
    mentor_review:
      "Lead with findings ordered by severity. For each finding include location, evidence, impact, and direction of correction.",
    mentor_debug:
      "Form ranked hypotheses, connect each to evidence, and propose one minimal discriminating experiment before a broad rewrite.",
    mentor_architecture:
      "Compare viable alternatives, trade-offs, migration cost, operational risks, and failure modes before recommending one.",
    mentor_learning:
      "Use guided questions, progressively reveal hints, and offer a small exercise; do not dump the final implementation immediately.",
    implementation:
      "Implementation is allowed only by explicit capabilities. Keep changes scoped and verify against acceptance criteria.",
  };
  base.push(modePolicy[task.mode]);

  if (!task.authorization.editFiles) {
    base.push("File editing is not authorized. Explain or suggest a patch without claiming files were changed.");
  }
  if (!task.authorization.runCommands) {
    base.push("Command execution is not authorized. Give verification commands as suggestions only.");
  }
  if (!task.authorization.useNetwork) {
    base.push("Network access is not authorized. Do not imply that external documentation was checked.");
  }

  return base.join("\n");
}
