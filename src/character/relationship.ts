import { clampUnit } from "../platform/mathUtils";
import type { CharacterEmotion } from "../types/character";

export type BondLevel =
  | "stranger"
  | "acquaintance"
  | "warming"
  | "familiar"
  | "close"
  | "intimate";

export type CharacterRelationship = {
  familiarity: number;
  trust: number;
  playfulness: number;
  exchanges: number;
  updatedAt: number;
  lastBondLevel?: BondLevel;
};

const RELATIONSHIP_KEY = "desktop-character.ari-relationship.v1";

const BOND_ORDER: BondLevel[] = [
  "stranger",
  "acquaintance",
  "warming",
  "familiar",
  "close",
  "intimate",
];

const initialRelationship: CharacterRelationship = {
  familiarity: 0.08,
  trust: 0.12,
  playfulness: 0.2,
  exchanges: 0,
  updatedAt: Date.now(),
};

const MILESTONE_LINES: Record<
  Exclude<BondLevel, "stranger">,
  { message: string; emotion: CharacterEmotion }
> = {
  acquaintance: {
    message: "Знаешь, мы уже не совсем незнакомцы. Это… приятно.",
    emotion: "curious",
  },
  warming: {
    message: "С тобой становится теплее. Не думай, что я это часто говорю.",
    emotion: "blush",
  },
  familiar: {
    message: "Мне уже привычно, что ты рядом. Странно было бы, если бы тебя не было.",
    emotion: "happy",
  },
  close: {
    message: "Между нами уже своя дистанция — близкая. Я это ценю.",
    emotion: "empathetic",
  },
  intimate: {
    message: "Ты для меня особенный. Да, я сказала это вслух.",
    emotion: "blush",
  },
};

export function computeBondScore(relationship: CharacterRelationship): number {
  return (
    relationship.familiarity * 0.4 +
    relationship.trust * 0.45 +
    relationship.playfulness * 0.15
  );
}

export function getBondLevel(
  relationship: CharacterRelationship,
): BondLevel {
  const score = computeBondScore(relationship);
  if (score < 0.15) return "stranger";
  if (score < 0.3) return "acquaintance";
  if (score < 0.45) return "warming";
  if (score < 0.6) return "familiar";
  if (score < 0.75) return "close";
  return "intimate";
}

export function loadRelationship(): CharacterRelationship {
  try {
    const stored = JSON.parse(
      localStorage.getItem(RELATIONSHIP_KEY) ?? "null",
    ) as Partial<CharacterRelationship> | null;
    if (!stored) return applyRelationshipDecay(initialRelationship);

    const relationship = {
      familiarity: clampUnit(stored.familiarity ?? 0.08),
      trust: clampUnit(stored.trust ?? 0.12),
      playfulness: clampUnit(stored.playfulness ?? 0.2),
      exchanges: Math.max(0, stored.exchanges ?? 0),
      updatedAt: stored.updatedAt ?? Date.now(),
      lastBondLevel: stored.lastBondLevel,
    };
    return applyRelationshipDecay(relationship);
  } catch {
    return applyRelationshipDecay(initialRelationship);
  }
}

function applyRelationshipDecay(
  relationship: CharacterRelationship,
): CharacterRelationship {
  const daysSince =
    (Date.now() - relationship.updatedAt) / (24 * 60 * 60 * 1000);
  if (daysSince < 2) {
    return relationship;
  }
  const decay = Math.min(0.1, (daysSince - 1) * 0.012);
  return {
    ...relationship,
    familiarity: clampUnit(relationship.familiarity - decay * 0.55),
    trust: clampUnit(relationship.trust - decay * 0.45),
    playfulness: clampUnit(relationship.playfulness - decay * 0.35),
  };
}

let relationshipCache: CharacterRelationship | null = null;

export function loadRelationshipCached(): CharacterRelationship {
  if (!relationshipCache) {
    relationshipCache = loadRelationship();
  }
  return relationshipCache;
}

function saveRelationship(
  relationship: CharacterRelationship,
): CharacterRelationship {
  const stable = {
    ...relationship,
    familiarity: clampUnit(relationship.familiarity),
    trust: clampUnit(relationship.trust),
    playfulness: clampUnit(relationship.playfulness),
    updatedAt: Date.now(),
  };
  localStorage.setItem(RELATIONSHIP_KEY, JSON.stringify(stable));
  relationshipCache = stable;
  return stable;
}

export function updateRelationshipAfterExchange(
  current: CharacterRelationship,
  userMessage: string,
  emotion: CharacterEmotion,
): CharacterRelationship {
  const personalDisclosure =
    /(я люблю|мне нравится|я предпочитаю|я хочу|я боюсь|мне трудно|мой проект|моя цель|обо мне)/i.test(
      userMessage,
    );
  const warmLanguage =
    /(спасибо|молодец|умница|красив|обожаю|ты лучш|рад тебя|приятно|люблю тебя|ты помогла|ты класс)/i.test(
      userMessage,
    );
  const compliment =
    /(ты умн|ты мила|ты прекрас|ты замечательн|ты особенн|подарок)/i.test(
      userMessage,
    );
  const hostileLanguage =
    /(заткнись|тупая|бесполезная|ненавижу|отвали)/i.test(userMessage);

  return saveRelationship({
    familiarity:
      current.familiarity +
      0.008 +
      (personalDisclosure ? 0.018 : 0) +
      (compliment ? 0.01 : 0),
    trust:
      current.trust +
      (personalDisclosure ? 0.02 : 0.005) +
      (warmLanguage ? 0.015 : 0) +
      (compliment ? 0.012 : 0) -
      (hostileLanguage ? 0.03 : 0),
    playfulness:
      current.playfulness +
      (emotion === "amused" ||
      emotion === "happy" ||
      emotion === "surprised"
        ? 0.01
        : 0) +
      (warmLanguage ? 0.008 : 0) +
      (compliment ? 0.006 : 0) -
      (hostileLanguage ? 0.025 : 0),
    exchanges: current.exchanges + 1,
    updatedAt: Date.now(),
    lastBondLevel: current.lastBondLevel,
  });
}

export function checkBondMilestone(
  before: CharacterRelationship,
  after: CharacterRelationship,
): {
  level: BondLevel;
  message: string;
  emotion: CharacterEmotion;
} | null {
  const previous = getBondLevel(before);
  const next = getBondLevel(after);
  const prevIndex = BOND_ORDER.indexOf(previous);
  const nextIndex = BOND_ORDER.indexOf(next);
  if (nextIndex <= prevIndex || next === "stranger") {
    return null;
  }
  const lastCelebrated = after.lastBondLevel
    ? BOND_ORDER.indexOf(after.lastBondLevel)
    : -1;
  if (nextIndex <= lastCelebrated) {
    return null;
  }
  const milestone = MILESTONE_LINES[next as Exclude<BondLevel, "stranger">];
  if (!milestone) {
    return null;
  }
  return { level: next, ...milestone };
}

export function markBondMilestone(
  relationship: CharacterRelationship,
  level: BondLevel,
): CharacterRelationship {
  return saveRelationship({ ...relationship, lastBondLevel: level });
}

export function applyHeadpatToRelationship(
  current: CharacterRelationship,
): CharacterRelationship {
  return saveRelationship({
    ...current,
    familiarity: current.familiarity + 0.012,
    trust: current.trust + 0.01,
    playfulness: current.playfulness + 0.028,
    exchanges: current.exchanges,
    updatedAt: Date.now(),
    lastBondLevel: current.lastBondLevel,
  });
}

export function describeRelationship(
  relationship: CharacterRelationship,
): string {
  const level = getBondLevel(relationship);
  const descriptions: Record<BondLevel, string> = {
    stranger:
      "знакомство свежее: Ari живая и ироничная, держит лёгкую дистанцию",
    acquaintance:
      "уже узнаёт пользователя, тон чуть теплее, но без фамильярности",
    warming:
      "привыкает к пользователю, появляется мягкая забота и личные отсылки",
    familiar:
      "хорошо знакома, общается непринуждённо, мягко поддразнивает",
    close:
      "близкая дистанция: говорит открыто, уверенная добрая язвительность",
    intimate:
      "особенная близость: тепло, доверие и редкая уязвимость без слащавости",
  };
  return descriptions[level];
}

export function describeBondForPrompt(
  relationship: CharacterRelationship,
  romanceMode: "disabled" | "subtle" | "allowed" = "subtle",
): string {
  const level = getBondLevel(relationship);
  const score = computeBondScore(relationship);
  const romanceHint =
    romanceMode === "disabled"
      ? "Флирт недопустим."
      : romanceMode === "subtle"
        ? level === "close" || level === "intimate"
          ? "Лёгкий флирт уместен, если не ломает сцену."
          : "Флирт только намёком, если очень уместно."
        : level === "familiar" || level === "close" || level === "intimate"
          ? "Флирт допустим, если тон сцены позволяет."
          : "Флирт сдержанно, без давления.";
  return `Ступень близости: ${level} (${Math.round(score * 100)}%). ${romanceHint}`;
}
