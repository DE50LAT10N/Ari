import type { ActiveWindowInfo } from "../platform/activeWindow";
import {
  describeClipboardSemantics,
  isClipboardSemanticallyRich,
} from "../platform/clipboardSemantics";
import {
  buildFileClarifyingQuestion,
  type ProactiveLlmBundle,
  type ProactiveSignalFact,
} from "./proactiveLlmEngine";

function cleanText(value?: string, max = 180): string {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[—\-:.,;\s]+/, "")
    .trim()
    .slice(0, max)
    .trim();
}

function compactWindow(window?: ActiveWindowInfo | null): string {
  if (!window) {
    return "";
  }
  const title = cleanText(window.title, 90);
  if (!title) {
    return cleanText(window.processName, 60);
  }
  return title;
}

export function buildVisibleAdviceFallback(input: {
  practicalHook?: string;
  linkNarrative?: string;
  signalSummary?: string;
  activeWindow?: ActiveWindowInfo | null;
}): string | null {
  const hook = cleanText(input.practicalHook, 190);
  const narrative = cleanText(input.linkNarrative, 170);
  const signal = cleanText(input.signalSummary, 170);
  const windowTitle = compactWindow(input.activeWindow);
  const anchor = hook || narrative || signal || windowTitle;
  if (!anchor) {
    return null;
  }

  if (hook && /\?/.test(hook)) {
    return hook.startsWith("Хм") ? hook : `Хм. ${hook}`;
  }

  const step =
    hook && hook !== anchor
      ? hook
      : windowTitle
        ? `сверь текущий экран «${windowTitle}» с последним действием`
        : "сначала проверь самый свежий конкретный сигнал, а не весь клубок сразу";

  if (step === anchor || anchor.includes(step) || step.includes(anchor)) {
    return `Хм. ${anchor}.`;
  }

  return [
    `Хм. Вижу рабочий след: ${anchor}.`,
    `Я бы начала с одного шага: ${step}.`,
  ].join(" ");
}

export function buildVisibleClarifyingFallback(
  facts: ProactiveSignalFact[],
  bundle?: ProactiveLlmBundle | null,
): string | null {
  if (bundle?.rejectReason?.includes("clarifying probe")) {
    const hook = cleanText(bundle.practicalHook, 220);
    if (hook) {
      return hook;
    }
  }

  const clip = facts.find((fact) => fact.kind === "clipboard");
  const file = facts.find((fact) => fact.kind === "file");
  const screen = facts.find((fact) => fact.kind === "screen");
  const wm = facts.find((fact) => fact.kind === "wm");
  const probeFact = clip ?? file ?? screen ?? wm;
  if (!probeFact) {
    return null;
  }

  if (clip) {
    if (isClipboardSemanticallyRich(clip.detail)) {
      const semantics = describeClipboardSemantics(clip.detail);
      return `В буфере «${cleanText(clip.detail, 80)}». Я бы зацепилась за ${cleanText(semantics, 120)}: проверь, какой переход или gate между этими элементами сейчас должен сработать.`;
    }
    return `В буфере «${cleanText(clip.detail, 80)}» — это текущая отладка или просто пример? Уточни, и я дам точный следующий шаг.`;
  }
  if (file) {
    return `${buildFileClarifyingQuestion(cleanText(file.detail, 80))} Уточни, и я дам точный следующий шаг.`;
  }
  if (screen) {
    return `На экране вижу «${cleanText(screen.detail, 80)}» — что из этого сейчас главная цель?`;
  }
  return `По недавней активности «${cleanText(probeFact.detail, 80)}» — какой результат ты хочешь получить сейчас?`;
}
