export type PhraseCategory =
  | "tease"
  | "greeting"
  | "care"
  | "shutdown"
  | "initiative";

export type PhraseMemory = {
  normalizedPhrase: string;
  originalPhrase: string;
  lastUsedAt: number;
  count: number;
  category: PhraseCategory;
};

const STORAGE_KEY = "desktop-character.phrase-memory.v1";
const MAX_PHRASES = 40;
let phraseCache: PhraseMemory[] | null = null;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function load(): PhraseMemory[] {
  if (phraseCache) {
    return phraseCache;
  }
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    phraseCache = Array.isArray(value) ? value : [];
    return phraseCache;
  } catch {
    phraseCache = [];
    return phraseCache;
  }
}

function classify(text: string, proactive: boolean): PhraseCategory {
  if (proactive) return "initiative";
  if (/(привет|доброе утро|добрый вечер)/i.test(text)) return "greeting";
  if (/(рядом|отдохни|перерыв|не дави на себя)/i.test(text)) return "care";
  if (/(пока|выключаюсь|до встречи)/i.test(text)) return "shutdown";
  return "tease";
}

export function rememberReplyPhrases(text: string, proactive = false): void {
  const candidates = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8 && part.length <= 100)
    .slice(0, 4);
  if (!candidates.length) return;

  const now = Date.now();
  const current = load();
  for (const phrase of candidates) {
    const normalizedPhrase = normalize(phrase);
    if (!normalizedPhrase) continue;
    const existing = current.find(
      (item) => item.normalizedPhrase === normalizedPhrase,
    );
    if (existing) {
      existing.lastUsedAt = now;
      existing.count += 1;
      existing.originalPhrase = phrase;
    } else {
      current.push({
        normalizedPhrase,
        originalPhrase: phrase,
        lastUsedAt: now,
        count: 1,
        category: classify(phrase, proactive),
      });
    }
  }
  phraseCache = current
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
    .slice(0, MAX_PHRASES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(phraseCache));
}

export function getRecentPhrases(limit = 8): PhraseMemory[] {
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
  return load()
    .filter(({ lastUsedAt }) => lastUsedAt >= cutoff)
    .sort(
      (left, right) =>
        right.count - left.count || right.lastUsedAt - left.lastUsedAt,
    )
    .slice(0, limit);
}

