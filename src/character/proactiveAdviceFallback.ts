import type { ActiveWindowInfo } from "../platform/activeWindow";

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

  const step =
    hook ||
    (windowTitle
      ? `сверь текущий экран «${windowTitle}» с последним действием`
      : "сначала проверь самый свежий конкретный сигнал, а не весь клубок сразу");

  return [
    `Хм. Вижу рабочий след: ${anchor}.`,
    `Я бы начала с одного шага: ${step}.`,
  ].join(" ");
}
