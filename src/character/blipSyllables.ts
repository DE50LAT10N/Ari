export type BlipToken =
  | "a"
  | "e"
  | "i"
  | "o"
  | "u"
  | "ya"
  | "mi"
  | "ne"
  | "hm"
  | "eh"
  | "n";

const vowelPattern = /[аеёиоуыэюя]/i;
const neutralTokens: BlipToken[] = ["hm", "eh", "n", "ya", "mi", "ne"];

export function vowelToBlipToken(char: string): BlipToken {
  const ch = char.toLowerCase();
  if (ch === "а" || ch === "я") return "a";
  if (ch === "э" || ch === "е" || ch === "ё") return "e";
  if (ch === "и" || ch === "ы") return "i";
  if (ch === "о") return "o";
  if (ch === "у" || ch === "ю") return "u";
  return neutralTokens[Math.floor(Math.random() * neutralTokens.length)]!;
}

export function splitIntoSyllables(word: string): string[] {
  if (!word) return [];
  const syllables: string[] = [];
  let current = "";

  for (let index = 0; index < word.length; index += 1) {
    const char = word[index]!;
    current += char;

    if (!vowelPattern.test(char)) {
      continue;
    }

    let nextIndex = index + 1;
    while (
      nextIndex < word.length &&
      !vowelPattern.test(word[nextIndex]!) &&
      !/\s/.test(word[nextIndex]!)
    ) {
      const remaining = word.slice(nextIndex);
      const nextVowel = remaining.search(vowelPattern);
      if (nextVowel <= 0) {
        current += word[nextIndex]!;
        index = nextIndex;
        nextIndex += 1;
        continue;
      }
      if (nextVowel === 1) {
        current += word[nextIndex]!;
        index = nextIndex;
      }
      break;
    }

    syllables.push(current);
    current = "";
  }

  if (current) {
    syllables.push(current);
  }

  return syllables.length ? syllables : [word];
}

export function syllableToBlipToken(syllable: string): BlipToken {
  const vowelMatch = syllable.match(vowelPattern);
  if (!vowelMatch) {
    return neutralTokens[Math.floor(Math.random() * neutralTokens.length)]!;
  }
  return vowelToBlipToken(vowelMatch[0]);
}

export type BlipEvent = {
  token: BlipToken;
  char: string;
  pauseMs: number;
};

export function buildBlipEvents(text: string): BlipEvent[] {
  const events: BlipEvent[] = [];
  let inCode = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (text.startsWith("```", index)) {
      inCode = !inCode;
      index += 2;
      continue;
    }
    if (inCode || char === "`") {
      continue;
    }
    if (/\s/.test(char)) {
      continue;
    }

    if (char === ",") {
      events.push({
        token: "hm",
        char,
        pauseMs: 120 + Math.floor(Math.random() * 60),
      });
      continue;
    }
    if (char === "." || char === "!" || char === "?") {
      events.push({
        token: char === "?" ? "eh" : "a",
        char,
        pauseMs: char === "!" ? 180 : 240 + Math.floor(Math.random() * 110),
      });
      continue;
    }
    if (char === "…" || (char === "." && text.slice(index, index + 3) === "...")) {
      events.push({ token: "hm", char, pauseMs: 160 });
      if (text.slice(index, index + 3) === "...") {
        index += 2;
      }
      continue;
    }
    if (!/[a-zа-яё]/i.test(char)) {
      continue;
    }

    const wordMatch = text.slice(index).match(/^[a-zа-яё]+/i);
    if (!wordMatch) {
      continue;
    }

    const word = wordMatch[0];
    const syllables = splitIntoSyllables(word);
    for (const syllable of syllables) {
      events.push({
        token: syllableToBlipToken(syllable),
        char: syllable,
        pauseMs: 0,
      });
    }
    index += word.length - 1;
  }

  return events;
}

export function buildMurmurChirp(count = 2): BlipEvent[] {
  const tokens: BlipToken[] = ["hm", "eh"];
  return Array.from({ length: count }, (_, index) => ({
    token: tokens[index % tokens.length]!,
    char: "",
    pauseMs: index === 0 ? 0 : 90,
  }));
}
