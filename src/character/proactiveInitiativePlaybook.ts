import type { InitiativeSignalBundle } from "./initiativeContext";
import type { ProactiveSignalFact } from "./proactiveLlmEngine";

export type ProactiveInitiativeMove =
  | "clipboard_probe"
  | "ide_invite"
  | "context_fact"
  | "followup_probe"
  | "task_bridge"
  | "concrete_step";

export type ProactiveMoveHint = {
  move: ProactiveInitiativeMove;
  groundFactIds: string[];
  hookSeed: string;
  questionSeed?: string;
  requireQuoteFromFacts: boolean;
};

function factByKind(facts: ProactiveSignalFact[], kind: ProactiveSignalFact["kind"]): ProactiveSignalFact | undefined {
  return facts.find((fact) => fact.kind === kind);
}

function isIdeWindow(bundle: InitiativeSignalBundle): boolean {
  const process = bundle.window?.processName ?? "";
  const title = bundle.window?.title ?? "";
  return /cursor|code|devenv|idea|rider|pycharm|webstorm|vim|neovim/i.test(process + title);
}

export function inferInitiativeMoves(
  bundle: InitiativeSignalBundle,
  facts: ProactiveSignalFact[],
  ragSnippets: string[] = [],
): ProactiveMoveHint[] {
  const hints: ProactiveMoveHint[] = [];
  const clip = factByKind(facts, "clipboard");
  const file = factByKind(facts, "file");
  const chat = factByKind(facts, "chat");
  const urgency = factByKind(facts, "urgency");
  const taskLink = facts.find((fact) => fact.id.startsWith("task:link"));
  const taskNext = factByKind(facts, "task");

  if (clip) {
    const quote = clip.detail.slice(0, 80);
    const fileBit = file ? ` в ${file.detail}` : "";
    hints.push({
      move: "clipboard_probe",
      groundFactIds: [clip.id, ...(file ? [file.id] : [])],
      hookSeed: `В буфере «${quote}»${fileBit} — это текущая отладка или просто пример?`,
      questionSeed: "Что именно сейчас пытаешься починить?",
      requireQuoteFromFacts: true,
    });
  }

  const stuckOnFile =
    bundle.advisor.stuckScore >= 0.45 ||
    urgency?.detail.toLowerCase().includes("застрял") ||
    bundle.focusBlockers.length > 0;

  if (file && (stuckOnFile || isIdeWindow(bundle))) {
    hints.push({
      move: "ide_invite",
      groundFactIds: [file.id],
      hookSeed: `Похоже, застряла на ${file.detail} — расскажи, где именно упираешься?`,
      questionSeed: "На каком шаге всё ломается?",
      requireQuoteFromFacts: true,
    });
  }

  if (chat && (clip || file || bundle.advisor.repeatedErrorSignature)) {
    hints.push({
      move: "followup_probe",
      groundFactIds: [chat.id, ...(clip ? [clip.id] : file ? [file.id] : [])],
      hookSeed: `Ты спрашивала «${chat.detail.slice(0, 60)}» — получилось продвинуться?`,
      questionSeed: "Что уже пробовала?",
      requireQuoteFromFacts: true,
    });
  }

  if (ragSnippets.length > 0) {
    const snippet = ragSnippets[0].slice(0, 100);
    hints.push({
      move: "context_fact",
      groundFactIds: facts.slice(0, 2).map((fact) => fact.id),
      hookSeed: `В твоих материалах было: «${snippet}» — это про текущую задачу?`,
      questionSeed: "Применимо к тому, что сейчас в IDE?",
      requireQuoteFromFacts: true,
    });
  }

  if (taskLink || taskNext) {
    const taskFact = taskLink ?? taskNext!;
    hints.push({
      move: "task_bridge",
      groundFactIds: [taskFact.id],
      hookSeed: `Это связано с задачей «${taskFact.detail.slice(0, 60)}»?`,
      requireQuoteFromFacts: false,
    });
  }

  if (file && !hints.some((hint) => hint.move === "ide_invite" || hint.move === "clipboard_probe")) {
    hints.push({
      move: "concrete_step",
      groundFactIds: [file.id],
      hookSeed: `Следующий проверяемый шаг по ${file.detail}: открыть файл и сверить последнее изменение.`,
      requireQuoteFromFacts: true,
    });
  }

  return hints.slice(0, 3);
}

export function pickBestMoveHint(hints: ProactiveMoveHint[]): ProactiveMoveHint | undefined {
  const priority: ProactiveInitiativeMove[] = [
    "clipboard_probe",
    "followup_probe",
    "ide_invite",
    "context_fact",
    "task_bridge",
    "concrete_step",
  ];
  for (const move of priority) {
    const match = hints.find((hint) => hint.move === move);
    if (match) {
      return match;
    }
  }
  return hints[0];
}
