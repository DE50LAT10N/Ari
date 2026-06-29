const DAY_MS = 86_400_000;

const RU_STOP_WORDS = new Set([
  "и",
  "в",
  "во",
  "на",
  "с",
  "со",
  "к",
  "ко",
  "по",
  "о",
  "об",
  "от",
  "до",
  "за",
  "из",
  "у",
  "не",
  "ни",
  "но",
  "а",
  "я",
  "ты",
  "он",
  "она",
  "мы",
  "вы",
  "они",
  "это",
  "то",
  "как",
  "что",
  "чтобы",
  "если",
  "или",
  "ли",
  "же",
  "бы",
  "уже",
  "ещё",
  "еще",
  "там",
  "тут",
  "тогда",
  "когда",
  "где",
  "кто",
  "чем",
  "для",
  "при",
  "над",
  "под",
  "без",
  "про",
  "мне",
  "меня",
  "тебя",
  "тебе",
  "мой",
  "моя",
  "моё",
  "мое",
  "твой",
  "твоя",
  "твоё",
  "твое",
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "with",
]);

const RU_SUFFIXES = [
  "иями",
  "ями",
  "ами",
  "ого",
  "его",
  "ому",
  "ему",
  "ыми",
  "ими",
  "ией",
  "ией",
  "ост",
  "ест",
  "ать",
  "ять",
  "ить",
  "ешь",
  "ишь",
  "ете",
  "ите",
  "ала",
  "али",
  "ило",
  "или",
  "ный",
  "ная",
  "ное",
  "ные",
  "ной",
  "ную",
  "ных",
  "ием",
  "ьем",
  "ием",
  "ами",
  "ях",
  "ах",
  "ов",
  "ев",
  "ом",
  "ем",
  "ам",
  "ям",
  "ую",
  "юю",
  "ой",
  "ей",
  "ий",
  "ый",
  "ая",
  "ое",
  "ые",
  "а",
  "я",
  "ы",
  "и",
  "е",
  "о",
  "у",
  "ю",
];

export function normalizeToken(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function lightRussianStem(word: string): string {
  if (word.length <= 3) {
    return word;
  }
  let stem = word;
  for (const suffix of RU_SUFFIXES) {
    if (stem.endsWith(suffix) && stem.length > suffix.length + 2) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  return stem.length >= 2 ? stem : word;
}

export function tokenizeText(text: string, minLength = 2): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(normalizeToken)
    .filter((word) => word.length >= minLength)
    .filter((word) => !RU_STOP_WORDS.has(word))
    .map(lightRussianStem);
}

export function freshnessBonus(
  timestamp: number,
  now = Date.now(),
): number {
  const ageDays = Math.max(0, (now - timestamp) / DAY_MS);
  return Math.max(0, 2.5 - ageDays * 0.12);
}

export function queryWordSet(query: string): Set<string> {
  const wordCount = query.trim().split(/\s+/).filter(Boolean).length;
  const minLength = wordCount <= 4 ? 2 : 2;
  return new Set(tokenizeText(query, minLength));
}

export function overlapScore(text: string, words: Set<string>): number {
  if (!words.size) {
    return 0;
  }
  const tokens = new Set(tokenizeText(text));
  let score = 0;
  for (const word of words) {
    if (tokens.has(word)) {
      score += 1;
      continue;
    }
    for (const token of tokens) {
      if (
        token.length >= 4 &&
        word.length >= 4 &&
        (token.startsWith(word) || word.startsWith(token))
      ) {
        score += 0.5;
        break;
      }
    }
  }
  return score;
}

export type RecallWeights = {
  lexical: number;
  semantic: number;
};

export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  lexical: 0.4,
  semantic: 0.6,
};

export function recallWeightsFromSettings(settings?: {
  recallLexicalWeight?: number;
  recallSemanticWeight?: number;
}): RecallWeights {
  if (!settings) {
    return DEFAULT_RECALL_WEIGHTS;
  }
  const lexical = settings.recallLexicalWeight ?? DEFAULT_RECALL_WEIGHTS.lexical;
  const semantic = settings.recallSemanticWeight ?? DEFAULT_RECALL_WEIGHTS.semantic;
  const sum = lexical + semantic || 1;
  return { lexical: lexical / sum, semantic: semantic / sum };
}

export function normalizeLexicalRecall(lexical: number): number {
  return Math.min(1, lexical / 3);
}

export function mixedRecallScore(
  lexical: number,
  semantic: number,
  weights: RecallWeights = DEFAULT_RECALL_WEIGHTS,
): number {
  const normalizedLexical = normalizeLexicalRecall(lexical);
  if (semantic <= 0) {
    return normalizedLexical;
  }
  return (
    weights.lexical * normalizedLexical + weights.semantic * semantic
  );
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function embeddingNorm(embedding: number[]): number {
  let sum = 0;
  for (const value of embedding) {
    sum += value * value;
  }
  return Math.sqrt(sum) || 0;
}

export function cosineSimilarityWithNorms(
  left: number[],
  leftNorm: number,
  right: number[],
  rightNorm: number,
): number {
  if (!left.length || left.length !== right.length || !leftNorm || !rightNorm) {
    return 0;
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return dot / (leftNorm * rightNorm);
}
