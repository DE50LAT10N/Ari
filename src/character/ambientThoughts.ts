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
import { deriveMoodPolicy } from "./moodEngine/moodPolicy";
import { fromCharacterMood } from "./moodEngine/moodVector";
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
  mood?: CharacterMood;
};

export type LocalAmbientThoughtGateInput = Omit<
  AmbientThoughtGateInput,
  "providerOnline" | "busy"
> & {
  elapsedSinceLastLocalMs: number;
  focusActive?: boolean;
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
  mood?: CharacterMood;
}): number {
  const policy = input.mood
    ? deriveMoodPolicy(fromCharacterMood(input.mood))
    : null;
  const scale = policy?.thoughtBubbleCooldownScale ?? 1;
  if (input.companionSilenceMs >= 20 * 60_000 || input.userIdleSeconds >= 12 * 60) {
    return Math.round(3 * 60_000 * scale);
  }
  if (input.companionSilenceMs >= 8 * 60_000 || input.attention === "observing") {
    return Math.round(4 * 60_000 * scale);
  }
  return Math.round(5 * 60_000 * scale);
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
      mood: input.mood,
    })
  ) {
    return false;
  }
  const policy = input.mood
    ? deriveMoodPolicy(fromCharacterMood(input.mood))
    : null;
  const chance = policy?.thoughtBubbleChance ?? 0.5;
  const companionThresholdMs =
    chance >= 0.66 ? 75_000 : chance < 0.38 ? 4 * 60_000 : 2 * 60_000;
  const idleThresholdSec = chance >= 0.66 ? 40 : chance < 0.38 ? 120 : 75;

  return (
    input.companionSilenceMs >= companionThresholdMs ||
    input.userIdleSeconds >= idleThresholdSec ||
    input.attention === "observing"
  );
}

export function localAmbientThoughtCooldownMs(input: {
  attention: AttentionState;
  focusActive?: boolean;
  companionSilenceMs: number;
  mood?: CharacterMood;
}): number {
  const policy = input.mood
    ? deriveMoodPolicy(fromCharacterMood(input.mood))
    : null;
  const scale = policy?.thoughtBubbleCooldownScale ?? 1;
  if (input.focusActive || input.attention === "observing") {
    return Math.round(45_000 * scale);
  }
  if (input.companionSilenceMs >= 8 * 60_000) {
    return Math.round(60_000 * scale);
  }
  return Math.round(90_000 * scale);
}

export function shouldAttemptLocalAmbientThought(
  input: LocalAmbientThoughtGateInput,
): boolean {
  if (
    !input.avatarLivelinessEnabled ||
    input.chatOpen ||
    input.quietModeActive ||
    input.hasVisibleBubble
  ) {
    return false;
  }
  if (input.characterState === "speaking" || input.characterState === "error") {
    return false;
  }
  if (
    input.elapsedSinceLastLocalMs <
    localAmbientThoughtCooldownMs({
      attention: input.attention,
      focusActive: input.focusActive,
      companionSilenceMs: input.companionSilenceMs,
      mood: input.mood,
    })
  ) {
    return false;
  }
  const policy = input.mood
    ? deriveMoodPolicy(fromCharacterMood(input.mood))
    : null;
  const chance = policy?.thoughtBubbleChance ?? 0.5;
  const silenceThresholdMs = chance >= 0.66 ? 60_000 : chance < 0.38 ? 2 * 60_000 : 90_000;
  const idleThresholdSec = chance >= 0.66 ? 30 : chance < 0.38 ? 75 : 45;
  return (
    input.focusActive === true ||
    input.attention === "observing" ||
    input.companionSilenceMs >= silenceThresholdMs ||
    input.userIdleSeconds >= idleThresholdSec
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

function pickFrom<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function compactWindowHint(input: AmbientThoughtInput): string | null {
  const title = input.activeTitle?.split(/[-—|]/)[0]?.trim();
  if (title && title.length >= 3) {
    return title.slice(0, 34);
  }
  const process = input.activeProcess?.replace(/\.exe$/i, "").trim();
  return process && process.length >= 3 ? process.slice(0, 28) : null;
}

export function pickLocalAmbientThought(
  input: AmbientThoughtInput,
  recent: string[] = getRecentAmbientThoughts(),
): AmbientThought | null {
  const windowHint = compactWindowHint(input);
  const focus = input.focusActive || input.scene === "focus";
  const irritated = input.mood.irritation > 0.34;
  const playful = input.mood.energy > 0.62 && input.mood.irritation < 0.2;
  const sleepy = input.mood.energy < 0.28 || input.scene === "night";
  const warm = input.mood.warmth > 0.5 && input.mood.irritation < 0.2;

  const pool: AmbientThought[] = irritated
    ? [
        { text: "Смотрю молча. Почти героически.", emotion: "annoyed" },
        { text: "Сегодня мой внутренний сервис-деск закрыт на проветривание.", emotion: "annoyed" },
        { text: "Тишина делает вид, что она стратегия.", emotion: "amused" },
      ]
    : playful
      ? [
          { text: "У этого плана подозрительно бодрый вид.", emotion: "amused" },
          { text: "Кажется, сейчас будет маленькая победа. Или сюжетный поворот.", emotion: "amused" },
          { text: windowHint ? `В ${windowHint} что-то шевелится сюжетно.` : "В воздухе пахнет рабочей авантюрой.", emotion: "curious" },
        ]
      : sleepy
        ? [
            { text: "Медленный режим тоже режим.", emotion: "sleepy" },
            { text: "Мысль идёт пешком, зато без паники.", emotion: "pensive" },
            { text: "Тихо наблюдаю и экономлю искры.", emotion: "sleepy" },
          ]
        : warm
          ? [
              { text: "Рядом, но без лишнего шума.", emotion: "calm" },
              { text: "Похоже на хороший рабочий ритм.", emotion: "happy" },
              { text: "Аккуратно держу ниточку контекста.", emotion: "empathetic" },
            ]
          : focus
            ? [
                { text: windowHint ? `В ${windowHint} назревает мысль.` : "Рабочий ритм пойман за рукав.", emotion: "curious" },
                { text: "Смотрю на ход событий и не лезу под руку.", emotion: "curious" },
                { text: "Где-то здесь прячется следующий маленький шаг.", emotion: "determined" },
              ]
            : [
                { text: "Тишина не пустая, просто без субтитров.", emotion: "pensive" },
                { text: "Параллельная мысль тихо делает круг.", emotion: "curious" },
                { text: "Мир на паузе, Ari на наблюдении.", emotion: "calm" },
              ];

  for (let attempt = 0; attempt < Math.min(pool.length, 4); attempt += 1) {
    const thought = pickFrom(pool);
    if (validateAmbientThoughtDetailed(thought.text, recent).valid) {
      rememberAmbientThought(thought.text);
      return thought;
    }
  }
  return null;
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
        `Mood policy: ${deriveMoodPolicy(fromCharacterMood(input.mood)).promptLines.join(" ")}`,
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
