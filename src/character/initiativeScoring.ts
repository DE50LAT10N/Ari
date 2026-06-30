import type { PresenceScene } from "./presence";
import { getRecentProactiveTopics } from "./proactiveState";
import type { CharacterMood } from "./mood";
import { moodInitiativeBias } from "./mood";
import type { UserIntent } from "./userIntent";
import type { InitiativeKind } from "./initiativeKinds";

export type InitiativeRisk = "low" | "medium" | "high";
export type InitiativeValue = "low" | "medium" | "high";

export type LocalInitiativeDecision = {
  allowed: boolean;
  reason: string;
  annoyanceRisk: InitiativeRisk;
  value: InitiativeValue;
};

export type InitiativeFeatureVector = {
  riskRank: number;
  valueRank: number;
  sceneFocus: number;
  sceneNight: number;
  hourBucket: number;
  moodBias: number;
  ignoredCount: number;
  intentWeight: number;
};

type PendingInitiativeEntry = {
  at: number;
  features: InitiativeFeatureVector;
};

const DAILY_KEY = "desktop-character.initiative-daily.v1";
const DAILY_KIND_KEY = "desktop-character.initiative-daily-kinds.v1";
const PENDING_KEY_V1 = "desktop-character.initiative-pending.v1";
const PENDING_KEY = "desktop-character.initiative-pending.v2";
const ADAPTIVE_KEY = "desktop-character.initiative-adaptive.v1";
const IGNORED_WINDOW_MS = 90 * 60_000;
const PENDING_EXPIRE_MS = 15 * 60_000;
const PLANNED_CHECK_MIN_SILENCE_MS = 12 * 60_000;
const LEARNING_RATE = 0.08;
const WEIGHT_CLIP = 2.5;

let dailyCountCache: { date: string; count: number } | null = null;
let dailyKindCache: {
  date: string;
  counts: Partial<Record<InitiativeKind, number>>;
} | null = null;

export function invalidateInitiativeScoringCache(): void {
  dailyCountCache = null;
  dailyKindCache = null;
}

type AdaptiveWeights = {
  bias: number;
  risk: number;
  value: number;
  sceneFocus: number;
  sceneNight: number;
  hour: number;
  mood: number;
  ignored: number;
  intent: number;
};

const DEFAULT_ADAPTIVE: AdaptiveWeights = {
  bias: -0.15,
  risk: -0.9,
  value: 0.85,
  sceneFocus: -0.35,
  sceneNight: -0.2,
  hour: 0.05,
  mood: 0.4,
  ignored: -0.7,
  intent: 0.25,
};

const EMPTY_FEATURES: InitiativeFeatureVector = {
  riskRank: 0,
  valueRank: 0,
  sceneFocus: 0,
  sceneNight: 0,
  hourBucket: 0,
  moodBias: 0,
  ignoredCount: 0,
  intentWeight: 0,
};

function rank(value: InitiativeRisk | InitiativeValue): number {
  return { low: 0, medium: 1, high: 2 }[value];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isFeatureVector(value: unknown): value is InitiativeFeatureVector {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as InitiativeFeatureVector;
  return (
    typeof candidate.riskRank === "number" &&
    typeof candidate.valueRank === "number"
  );
}

function isPendingEntry(value: unknown): value is PendingInitiativeEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as PendingInitiativeEntry;
  return typeof candidate.at === "number" && isFeatureVector(candidate.features);
}

function migratePendingFromV1(): PendingInitiativeEntry[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY_V1);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((value): value is number => typeof value === "number")
      .map((at) => ({ at, features: { ...EMPTY_FEATURES } }));
  } catch {
    return [];
  }
}

function loadPendingEntries(): PendingInitiativeEntry[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(isPendingEntry);
      }
    }
  } catch {
    // fall through to migration
  }
  const migrated = migratePendingFromV1();
  if (migrated.length) {
    savePendingEntries(migrated);
    localStorage.removeItem(PENDING_KEY_V1);
  }
  return migrated;
}

function savePendingEntries(entries: PendingInitiativeEntry[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(entries));
}

function prunePendingWindow(
  entries: PendingInitiativeEntry[],
  now = Date.now(),
): PendingInitiativeEntry[] {
  return entries.filter((entry) => now - entry.at < IGNORED_WINDOW_MS);
}

function loadAdaptiveWeights(): AdaptiveWeights {
  try {
    const stored = JSON.parse(
      localStorage.getItem(ADAPTIVE_KEY) ?? "null",
    ) as Partial<AdaptiveWeights> | null;
    if (!stored) {
      return { ...DEFAULT_ADAPTIVE };
    }
    return { ...DEFAULT_ADAPTIVE, ...stored };
  } catch {
    return { ...DEFAULT_ADAPTIVE };
  }
}

function saveAdaptiveWeights(weights: AdaptiveWeights): void {
  localStorage.setItem(ADAPTIVE_KEY, JSON.stringify(weights));
}

function clipWeight(value: number): number {
  return Math.max(-WEIGHT_CLIP, Math.min(WEIGHT_CLIP, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function intentFeature(intent?: UserIntent): number {
  if (!intent) {
    return 0;
  }
  return {
    question: 0.2,
    task_command: 0.5,
    request_action: 0.4,
    emotional_support: 0.7,
    technical_help: 0.35,
    feedback: -0.2,
    smalltalk: 0.1,
  }[intent];
}

export function buildInitiativeFeatures({
  risk,
  value,
  scene,
  mood,
  ignoredCount,
  intent,
}: {
  risk: InitiativeRisk;
  value: InitiativeValue;
  scene: PresenceScene;
  mood?: CharacterMood;
  ignoredCount: number;
  intent?: UserIntent;
}): InitiativeFeatureVector {
  const hour = new Date().getHours();
  return {
    riskRank: rank(risk),
    valueRank: rank(value),
    sceneFocus: scene === "focus" ? 1 : 0,
    sceneNight: scene === "night" ? 1 : 0,
    hourBucket: hour >= 23 || hour < 6 ? 1 : hour >= 19 ? 0.5 : 0,
    moodBias: mood ? moodInitiativeBias(mood) : 0,
    ignoredCount,
    intentWeight: intentFeature(intent),
  };
}

function scoreAdaptive(
  features: InitiativeFeatureVector,
  weights: AdaptiveWeights,
): number {
  return (
    weights.bias +
    weights.risk * features.riskRank +
    weights.value * features.valueRank +
    weights.sceneFocus * features.sceneFocus +
    weights.sceneNight * features.sceneNight +
    weights.hour * features.hourBucket +
    weights.mood * features.moodBias +
    weights.ignored * features.ignoredCount +
    weights.intent * features.intentWeight
  );
}

export function recordInitiativeOutcome(
  features: InitiativeFeatureVector,
  engaged: boolean,
): void {
  const weights = loadAdaptiveWeights();
  const linear = scoreAdaptive(features, weights);
  const prediction = sigmoid(linear);
  const target = engaged ? 1 : 0;
  const error = prediction - target;

  const next: AdaptiveWeights = {
    bias: clipWeight(weights.bias - LEARNING_RATE * error),
    risk: clipWeight(weights.risk - LEARNING_RATE * error * features.riskRank),
    value: clipWeight(weights.value - LEARNING_RATE * error * features.valueRank),
    sceneFocus: clipWeight(
      weights.sceneFocus - LEARNING_RATE * error * features.sceneFocus,
    ),
    sceneNight: clipWeight(
      weights.sceneNight - LEARNING_RATE * error * features.sceneNight,
    ),
    hour: clipWeight(weights.hour - LEARNING_RATE * error * features.hourBucket),
    mood: clipWeight(weights.mood - LEARNING_RATE * error * features.moodBias),
    ignored: clipWeight(
      weights.ignored - LEARNING_RATE * error * features.ignoredCount,
    ),
    intent: clipWeight(
      weights.intent - LEARNING_RATE * error * features.intentWeight,
    ),
  };
  saveAdaptiveWeights(next);
}

export function pruneExpiredPendingInitiatives(
  adaptiveEnabled: boolean,
  now = Date.now(),
): number {
  const pending = loadPendingEntries();
  const kept: PendingInitiativeEntry[] = [];
  let ignoredCount = 0;
  for (const entry of pending) {
    if (now - entry.at >= IGNORED_WINDOW_MS) {
      continue;
    }
    if (now - entry.at >= PENDING_EXPIRE_MS) {
      ignoredCount += 1;
      if (adaptiveEnabled) {
        recordInitiativeOutcome(entry.features, false);
      }
      continue;
    }
    kept.push(entry);
  }
  savePendingEntries(kept);
  return ignoredCount;
}

export function getDailyInitiativeCount(): number {
  const key = today();
  if (dailyCountCache?.date === key) {
    return dailyCountCache.count;
  }
  try {
    const stored = JSON.parse(localStorage.getItem(DAILY_KEY) ?? "{}") as {
      date?: string;
      count?: number;
    };
    dailyCountCache = {
      date: stored.date ?? "",
      count: stored.date === key ? stored.count ?? 0 : 0,
    };
    return dailyCountCache.date === key ? dailyCountCache.count : 0;
  } catch {
    dailyCountCache = { date: key, count: 0 };
    return 0;
  }
}

function loadDailyKindCounts(): Partial<Record<InitiativeKind, number>> {
  const key = today();
  if (dailyKindCache?.date === key) {
    return { ...dailyKindCache.counts };
  }
  try {
    const stored = JSON.parse(localStorage.getItem(DAILY_KIND_KEY) ?? "{}") as {
      date?: string;
      counts?: Partial<Record<InitiativeKind, number>>;
    };
    dailyKindCache = {
      date: stored.date ?? "",
      counts: stored.date === key ? stored.counts ?? {} : {},
    };
    return { ...dailyKindCache.counts };
  } catch {
    dailyKindCache = { date: key, counts: {} };
    return {};
  }
}

export function getDailyInitiativeKindCount(kind: InitiativeKind): number {
  return loadDailyKindCounts()[kind] ?? 0;
}

export function isDailyKindCapReached(kind: InitiativeKind, cap: number): boolean {
  return getDailyInitiativeKindCount(kind) >= cap;
}

function markDailyInitiativeKind(kind: InitiativeKind): void {
  const key = today();
  const counts = loadDailyKindCounts();
  counts[kind] = (counts[kind] ?? 0) + 1;
  dailyKindCache = { date: key, counts };
  localStorage.setItem(
    DAILY_KIND_KEY,
    JSON.stringify({ date: key, counts }),
  );
}

export function markInitiativeSent(
  features: InitiativeFeatureVector = EMPTY_FEATURES,
  adaptiveEnabled = false,
  kind?: InitiativeKind,
): void {
  const key = today();
  dailyCountCache = { date: key, count: getDailyInitiativeCount() + 1 };
  localStorage.setItem(DAILY_KEY, JSON.stringify(dailyCountCache));
  if (kind) {
    markDailyInitiativeKind(kind);
  }

  const pending = prunePendingWindow(loadPendingEntries());
  if (adaptiveEnabled && pending.length > 0) {
    for (const entry of pending) {
      recordInitiativeOutcome(entry.features, false);
    }
    savePendingEntries([{ at: Date.now(), features }]);
    return;
  }
  pending.push({ at: Date.now(), features });
  savePendingEntries(pending);
}

export function markInitiativeAcknowledged(): void {
  savePendingEntries([]);
}

export function getRecentIgnoredInitiativeCount(): number {
  return prunePendingWindow(loadPendingEntries()).length;
}

function initiativeTopicOverlapText(description: string): string {
  return description
    .replace(
      /недавние темы инициативы, которые нельзя повторять:[^\n]*/gi,
      "",
    )
    .replace(
      /возможные темы[^:]*:[^\n]*(?:\n- [^\n]+)*/gi,
      "",
    )
    .toLowerCase();
}

export function scoreInitiativeLocally({
  description,
  scene,
  chatClosedAgoMs,
  userActivityAgoMs,
  dailyCap = 4,
  riskTolerance = 0,
  plannedCheckMinSilenceMs = PLANNED_CHECK_MIN_SILENCE_MS,
  openLoopHint,
  mood,
  intent,
  adaptiveEnabled = false,
  plannedCheckFreshTopics,
}: {
  description: string;
  scene: PresenceScene;
  chatClosedAgoMs: number;
  userActivityAgoMs: number;
  dailyCap?: number;
  riskTolerance?: number;
  plannedCheckMinSilenceMs?: number;
  openLoopHint?: string;
  mood?: CharacterMood;
  intent?: UserIntent;
  adaptiveEnabled?: boolean;
  plannedCheckFreshTopics?: boolean;
}): LocalInitiativeDecision {
  const normalized = description.toLowerCase();
  const overlapText = initiativeTopicOverlapText(description);
  const dailyCount = getDailyInitiativeCount();
  const ignoredCount = getRecentIgnoredInitiativeCount();
  const recentlyIgnored = ignoredCount > 0;
  const recentTopics = getRecentProactiveTopics();
  const plannedCheckReady =
    /плановая проверка инициативы/.test(normalized) &&
    userActivityAgoMs >= plannedCheckMinSilenceMs;
  const freshTopicsAvailable =
    plannedCheckFreshTopics ??
    /доступны свежие темы:\s*да/i.test(normalized);
  const skipBroadTopicOverlap =
    plannedCheckReady && freshTopicsAvailable;
  const repeated = skipBroadTopicOverlap
    ? false
    : recentTopics.some((topic) => {
        const words = topic
          .toLowerCase()
          .split(/\W+/)
          .filter((word) => word.length > 4);
        const overlap = words.filter((word) => overlapText.includes(word))
          .length;
        return words.length > 1 && overlap >= 2;
      });
  const stronglyRepeated = skipBroadTopicOverlap
    ? false
    : recentTopics.some((topic) => {
        const words = topic
          .toLowerCase()
          .split(/\W+/)
          .filter((word) => word.length > 4);
        const overlap = words.filter((word) => overlapText.includes(word))
          .length;
        return words.length > 2 && overlap >= 3;
      });

  let risk: InitiativeRisk = "low";
  if (scene === "focus" || chatClosedAgoMs < 5 * 60_000) risk = "medium";
  const minUserSilenceMs = plannedCheckReady
    ? Math.min(60_000, plannedCheckMinSilenceMs)
    : 60_000;
  if (
    (dailyCap < 9999 && dailyCount >= dailyCap) ||
    recentlyIgnored ||
    userActivityAgoMs < minUserSilenceMs
  ) {
    risk = "high";
  }

  let value: InitiativeValue = "low";
  if (openLoopHint && /(срок|напомин|незаверш|обещал)/i.test(openLoopHint)) {
    value = "high";
  } else if (/(срок|напомин|ошибк|опасн|незаверш|обещал)/.test(normalized)) {
    value = "high";
  } else if (
    /(вернул|около часа|перерыв|переключился)/.test(normalized) ||
    plannedCheckReady
  ) {
    value = "medium";
  }
  if (repeated) value = "low";
  if (plannedCheckReady && !freshTopicsAvailable && riskTolerance < 1) {
    return {
      allowed: false,
      reason: "нет свежих тем для инициативы",
      annoyanceRisk: "medium",
      value: "low",
    };
  }

  if (stronglyRepeated) {
    return {
      allowed: false,
      reason: "тема слишком похожа на недавнюю инициативу",
      annoyanceRisk: "high",
      value: "low",
    };
  }

  const moodBias = mood ? moodInitiativeBias(mood) : 0;
  const features = buildInitiativeFeatures({
    risk,
    value,
    scene,
    mood,
    ignoredCount,
    intent,
  });

  let allowed: boolean;
  if (adaptiveEnabled) {
    const weights = loadAdaptiveWeights();
    allowed = sigmoid(scoreAdaptive(features, weights)) > 0.5;
  } else {
    allowed = rank(value) - rank(risk) > -riskTolerance + moodBias;
  }

  if (plannedCheckReady && freshTopicsAvailable && riskTolerance >= 0) {
    allowed = true;
  }

  const reason = repeated
    ? "тема похожа на недавнюю инициативу"
    : plannedCheckReady && allowed && riskTolerance >= 0
      ? "плановая проверка после тишины"
      : recentlyIgnored
        ? "недавняя инициатива осталась без реакции"
        : dailyCount >= dailyCap
          ? "достигнут дневной лимит инициатив"
          : scene === "focus" && value !== "high"
            ? "пользователь в focused work"
            : allowed
              ? "ценность повода выше риска раздражения"
              : "нет достаточно конкретного повода";

  return { allowed, reason, annoyanceRisk: risk, value };
}

export function shouldUseLlmInitiativeGate(
  decision: LocalInitiativeDecision,
  options: { skipForPlannedCheckIn?: boolean } = {},
): boolean {
  if (!decision.allowed) {
    return false;
  }
  if (options.skipForPlannedCheckIn) {
    return false;
  }
  if (decision.value === "high" && decision.annoyanceRisk === "low") {
    return false;
  }
  if (decision.value === "medium" && decision.annoyanceRisk === "low") {
    return false;
  }
  return true;
}

export function isPlannedCheckDescription(description: string): boolean {
  return /плановая проверка инициативы/i.test(description);
}
