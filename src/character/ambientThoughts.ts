import { completeLlmJson } from "../llm/llmClient";
import type { AppSettings } from "../settings/appSettings";
import {
  characterEmotions,
  isCharacterEmotion,
  type CharacterState,
  type CharacterEmotion,
} from "../types/character";
import type { ChatMessage } from "../types/chat";
import type { AttentionState } from "./attention";
import type { CharacterMood } from "./mood";
import { describeMoodForPrompt } from "./mood";
import type { PresenceScene } from "./presence";

const RECENT_THOUGHTS_KEY = "ari.ambientThoughts.recent.v1";
const RECENT_TTL_MS = 4 * 60 * 60 * 1000;
const RECENT_LIMIT = 18;

type RecentThought = {
  text: string;
  at: number;
};

export type AmbientThoughtInput = {
  scene: PresenceScene;
  attention: AttentionState;
  mood: CharacterMood;
  activeProcess?: string;
  activeTitle?: string;
  userIdleSeconds: number;
  companionSilenceMs: number;
  pomodoroPhase?: string;
  focusActive?: boolean;
  characterState?: CharacterState;
  hour?: number;
};

export type AmbientThought = {
  text: string;
  emotion: CharacterEmotion;
};

export type AmbientThoughtGateInput = {
  providerOnline: boolean;
  avatarLivelinessEnabled: boolean;
  chatOpen: boolean;
  characterState?: CharacterState;
  quietModeActive: boolean;
  hasVisibleBubble: boolean;
  busy: boolean;
  elapsedSinceLastMs: number;
  userIdleSeconds: number;
  companionSilenceMs: number;
  attention: AttentionState;
};

type AmbientThoughtResponse = {
  shouldShow?: boolean;
  text?: string;
  emotion?: string;
  reason?: string;
};

export function ambientThoughtCooldownMs(input: {
  userIdleSeconds: number;
  companionSilenceMs: number;
  attention: AttentionState;
}): number {
  if (input.companionSilenceMs >= 20 * 60_000 || input.userIdleSeconds >= 12 * 60) {
    return 3 * 60_000;
  }
  if (input.companionSilenceMs >= 8 * 60_000 || input.attention === "observing") {
    return 4 * 60_000;
  }
  return 5 * 60_000;
}

export function shouldAttemptAmbientThought(input: AmbientThoughtGateInput): boolean {
  if (
    !input.providerOnline ||
    !input.avatarLivelinessEnabled ||
    input.chatOpen ||
    input.quietModeActive ||
    input.hasVisibleBubble ||
    input.busy
  ) {
    return false;
  }
  if (input.characterState === "speaking" || input.characterState === "error") {
    return false;
  }
  if (
    input.elapsedSinceLastMs <
    ambientThoughtCooldownMs({
      userIdleSeconds: input.userIdleSeconds,
      companionSilenceMs: input.companionSilenceMs,
      attention: input.attention,
    })
  ) {
    return false;
  }

  return (
    input.companionSilenceMs >= 2 * 60_000 ||
    input.userIdleSeconds >= 75 ||
    input.attention === "observing"
  );
}

function loadRecentThoughtEntries(now = Date.now()): RecentThought[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(RECENT_THOUGHTS_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is RecentThought =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as RecentThought).text === "string" &&
          typeof (entry as RecentThought).at === "number",
      )
      .filter((entry) => now - entry.at < RECENT_TTL_MS)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function getRecentAmbientThoughts(now = Date.now()): string[] {
  return loadRecentThoughtEntries(now).map((entry) => entry.text);
}

export function rememberAmbientThought(text: string, at = Date.now()): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const entries = [
    { text: trimmed, at },
    ...loadRecentThoughtEntries(at).filter((entry) => entry.text !== trimmed),
  ].slice(0, RECENT_LIMIT);
  localStorage.setItem(RECENT_THOUGHTS_KEY, JSON.stringify(entries));
}

export function resetAmbientThoughtsForTests(): void {
  localStorage.removeItem(RECENT_THOUGHTS_KEY);
}

function normalizeThought(text: string): string {
  return text
    .toLowerCase()
    .replace(/<emotion>[^<]+<\/emotion>/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .join(" ")
    .trim();
}

function similarity(a: string, b: string): number {
  const left = new Set(normalizeThought(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalizeThought(b).split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) {
    return 0;
  }
  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(left.size, right.size);
}

export type AmbientThoughtValidationIssue =
  | "empty"
  | "length"
  | "question"
  | "addressed_user"
  | "generic_or_meta"
  | "repeat";

export type AmbientThoughtValidationResult = {
  valid: boolean;
  issues: AmbientThoughtValidationIssue[];
};

type AmbientThoughtValidationRule = {
  issue: AmbientThoughtValidationIssue;
  fails: (input: {
    text: string;
    normalized: string;
    recent: string[];
  }) => boolean;
};

const GENERIC_OR_META_PATTERNS = [
  /fallback|фолб[эе]к|шаблон|дежурн/,
  /как дела|что делаешь|чем занимаешься/,
  /я здесь|я рядом|если что|пользователь|человек/,
  /не знаю что сказать|мало контекста/,
  /напомин|советую|попробуй|давай|можешь|нужно/,
];

const ADDRESSED_USER_PATTERNS = [
  /(^|\s)(ты|тебе|тебя|тобой|твой|твоя|твое|твоё|твои)(\s|$)/,
  /(^|\s)(вы|вам|вас|вами|ваш|ваша|ваше|ваши)(\s|$)/,
  /(^|\s)(сделай|посмотри|проверь|открой|закрой|вернись|отдохни|выдохни)(\s|$)/,
];

const AMBIENT_THOUGHT_RULES: AmbientThoughtValidationRule[] = [
  {
    issue: "empty",
    fails: ({ normalized }) => !normalized,
  },
  {
    issue: "length",
    fails: ({ text }) => text.length < 12 || text.length > 150,
  },
  {
    issue: "question",
    fails: ({ text }) => /[?？]/u.test(text),
  },
  {
    issue: "addressed_user",
    fails: ({ text }) => {
      const cleaned = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .trim();
      return ADDRESSED_USER_PATTERNS.some((pattern) => pattern.test(cleaned));
    },
  },
  {
    issue: "generic_or_meta",
    fails: ({ normalized }) =>
      GENERIC_OR_META_PATTERNS.some((pattern) => pattern.test(normalized)),
  },
  {
    issue: "repeat",
    fails: ({ text, recent }) =>
      recent.some(
        (previous) =>
          previous.trim().toLowerCase() === text.toLowerCase() ||
          similarity(previous, text) >= 0.72,
      ),
  },
];

export function validateAmbientThoughtDetailed(
  text: string,
  recent: string[] = getRecentAmbientThoughts(),
): AmbientThoughtValidationResult {
  const trimmed = text.trim();
  const normalized = normalizeThought(trimmed);
  const issues = AMBIENT_THOUGHT_RULES.filter((rule) =>
    rule.fails({ text: trimmed, normalized, recent }),
  ).map((rule) => rule.issue);
  return { valid: issues.length === 0, issues };
}

export function validateAmbientThought(
  text: string,
  recent: string[] = getRecentAmbientThoughts(),
): boolean {
  return validateAmbientThoughtDetailed(text, recent).valid;
}

function compactActiveWindow(input: AmbientThoughtInput): string {
  if (!input.activeProcess && !input.activeTitle) {
    return "нет активного окна";
  }
  return [input.activeProcess, input.activeTitle].filter(Boolean).join(" - ");
}

function buildPrompt(input: AmbientThoughtInput, recent: string[]): ChatMessage[] {
  const hour = input.hour ?? new Date().getHours();
  return [
    {
      role: "system",
      content: [
        "Ты Ari, живая desktop-компаньонка. Сгенерируй одну внутреннюю микромысль для speech bubble рядом с аватаром.",
        "Это НЕ сообщение пользователю и НЕ запись в историю чата. Она должна звучать как мимолетная мысль про себя.",
        "Пиши по-русски, 1 короткое предложение, 5-18 слов. Без советов, инструкций, вопросов, приветствий и check-in.",
        "Не обращайся к человеку напрямую: не используй «ты», «тебе», «давай», «попробуй», «можешь», «нужно».",
        "Форма: внутренний монолог, фрагмент наблюдения или мысль в сторону. Можно от первого лица, но не «я рядом/если что».",
        "Мысль может быть не только про текущий файл: допустимы боковые наблюдения, настроение, странная ассоциация, культурная или новостная искра.",
        "Если нет live-проверки новости, не называй конкретные свежие факты, даты, имена и заголовки; говори как о поводе или ассоциации.",
        "Не используй fallback/meta-текст, не объясняй нехватку контекста, не копируй недавние мысли.",
        "Тон: живой, наблюдательный, чуть характерный; можно мягкую иронию, но без навязчивости.",
        `Допустимые emotion: ${characterEmotions.join(", ")}.`,
        'JSON: {"shouldShow":true,"text":"...","emotion":"curious","reason":"коротко почему момент подходит"}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Сцена: ${input.scene}`,
        `Внимание: ${input.attention}`,
        `Настроение Ari: ${describeMoodForPrompt(input.mood)}`,
        `Окно: ${compactActiveWindow(input)}`,
        `Пользователь idle: ${Math.round(input.userIdleSeconds)} сек`,
        `Тишина с Ari: ${Math.round(input.companionSilenceMs / 60_000)} мин`,
        `Помодоро: ${input.pomodoroPhase ?? "нет"}`,
        `Фокус активен: ${input.focusActive ? "да" : "нет"}`,
        `Состояние Ari: ${input.characterState ?? "неизвестно"}`,
        `Час: ${hour}`,
        recent.length
          ? `Недавние мысли, которые нельзя повторять или перефразировать:\n${recent
              .slice(0, 10)
              .map((item) => `- ${item}`)
              .join("\n")}`
          : "Недавних мыслей нет.",
      ].join("\n"),
    },
  ];
}

export async function generateAmbientThought(
  settings: AppSettings,
  input: AmbientThoughtInput,
): Promise<AmbientThought | null> {
  const recent = getRecentAmbientThoughts();
  try {
    const response = await completeLlmJson<AmbientThoughtResponse>(
      buildPrompt(input, recent),
      settings,
      180,
      "initiativeSynthesis",
    );
    if (response.shouldShow === false) {
      return null;
    }
    const text = typeof response.text === "string" ? response.text.trim() : "";
    if (!validateAmbientThoughtDetailed(text, recent).valid) {
      return null;
    }
    const emotion =
      typeof response.emotion === "string" && isCharacterEmotion(response.emotion)
        ? response.emotion
        : "curious";
    rememberAmbientThought(text);
    return { text, emotion };
  } catch {
    return null;
  }
}
