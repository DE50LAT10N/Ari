import type { AppSettings } from "../settings/appSettings";
import { stripEmotionMarkup } from "./emotionTags";

export type BlipReplyMode = "animalese" | "murmur";

export function cleanTextForBlip(raw: string): string {
  return stripEmotionMarkup(raw)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\{[\s\S]*?\}/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTooLongForAutoBlip(
  text: string,
  settings: AppSettings,
): boolean {
  return cleanTextForBlip(text).length > settings.blipMaxReplyChars;
}

export function isTechnicalReply(text: string): boolean {
  const normalized = cleanTextForBlip(text).toLowerCase();
  if (/```/.test(text)) return true;
  if (/(ошибк|typescript|rust|tauri|api|код|функци|класс|модул|сборк|npm|cargo)/i.test(normalized)) {
    return true;
  }
  const lines = normalized.split(/\n+/).filter(Boolean);
  const listLines = lines.filter((line) => /^[-*•\d]+[.)]?\s/.test(line));
  return listLines.length >= 3;
}

function firstSentences(text: string, count: number): string {
  const parts = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [text];
  return parts.slice(0, count).join(" ").trim();
}

export function resolveBlipScope(
  raw: string,
  options: {
    technical?: boolean;
    murmurForced?: boolean;
  } = {},
): { mode: BlipReplyMode; text: string } {
  const cleaned = cleanTextForBlip(raw);
  if (!cleaned) {
    return { mode: "murmur", text: "" };
  }

  if (options.murmurForced || options.technical || isTechnicalReply(raw)) {
    return { mode: "murmur", text: cleaned };
  }

  if (cleaned.length <= 200) {
    return { mode: "animalese", text: cleaned };
  }
  if (cleaned.length <= 700) {
    return { mode: "animalese", text: firstSentences(cleaned, 2) };
  }
  return { mode: "murmur", text: cleaned };
}
