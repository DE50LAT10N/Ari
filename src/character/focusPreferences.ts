import type { FocusSession } from "./focusSession";

export type FocusSessionStat = {
  plannedMinutes: number;
  actualMinutes: number;
  abandoned: boolean;
  hour: number;
  completedAt: number;
};

export type FocusPreferenceProfile = {
  bestSessionLengthMinutes: number;
  averageCompletionRate: number;
  oftenAbandonsAfterMinute?: number;
  preferredBreakLengthMinutes: number;
  productiveTimeBands: string[];
  sessionStats: FocusSessionStat[];
};

const STORAGE_KEY = "desktop-character.focus-preferences.v1";
const MAX_STATS = 40;

const defaultProfile: FocusPreferenceProfile = {
  bestSessionLengthMinutes: 25,
  averageCompletionRate: 1,
  preferredBreakLengthMinutes: 5,
  productiveTimeBands: [],
  sessionStats: [],
};

function timeBand(hour: number): string {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function loadFocusPreferences(): FocusPreferenceProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultProfile };
    const parsed = JSON.parse(raw) as Partial<FocusPreferenceProfile>;
    return {
      ...defaultProfile,
      ...parsed,
      sessionStats: Array.isArray(parsed.sessionStats)
        ? parsed.sessionStats
        : [],
    };
  } catch {
    return { ...defaultProfile };
  }
}

function saveFocusPreferences(profile: FocusPreferenceProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function recordFocusSessionStat(session: FocusSession): void {
  if (!session.endedAt) return;

  const actualMinutes = Math.round(
    (session.endedAt - session.startedAt) / 60_000,
  );
  const hour = new Date(session.startedAt).getHours();
  const stat: FocusSessionStat = {
    plannedMinutes: session.plannedMinutes,
    actualMinutes,
    abandoned: session.result === "abandoned",
    hour,
    completedAt: session.endedAt,
  };

  const profile = loadFocusPreferences();
  const sessionStats = [stat, ...profile.sessionStats].slice(0, MAX_STATS);
  const completed = sessionStats.filter((item) => !item.abandoned);
  const abandoned = sessionStats.filter((item) => item.abandoned);

  const completionRate =
    sessionStats.length > 0 ? completed.length / sessionStats.length : 1;

  const completedLengths = completed.map((item) => item.actualMinutes);
  const bestSessionLengthMinutes =
    completedLengths.length > 0
      ? Math.round(
          completedLengths.reduce((sum, value) => sum + value, 0) /
            completedLengths.length,
        )
      : profile.bestSessionLengthMinutes;

  const bandCounts = new Map<string, number>();
  for (const item of completed) {
    const band = timeBand(item.hour);
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
  }
  const productiveTimeBands = [...bandCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([band]) => band);

  let oftenAbandonsAfterMinute: number | undefined;
  if (abandoned.length >= 2) {
    const abandonMinutes = abandoned.map((item) => item.actualMinutes);
    oftenAbandonsAfterMinute = Math.round(
      abandonMinutes.reduce((sum, value) => sum + value, 0) /
        abandonMinutes.length,
    );
  }

  saveFocusPreferences({
    bestSessionLengthMinutes,
    averageCompletionRate: completionRate,
    oftenAbandonsAfterMinute,
    preferredBreakLengthMinutes: session.breakMinutes,
    productiveTimeBands,
    sessionStats,
  });
}

export type DurationSuggestion = {
  suggestedMinutes: number;
  reason: string;
};

export function suggestNextDuration(
  defaultMinutes: number,
  hour = new Date().getHours(),
): DurationSuggestion | null {
  const profile = loadFocusPreferences();
  if (profile.sessionStats.length < 3) return null;

  let suggested = defaultMinutes;
  const recent = profile.sessionStats.slice(0, 5);
  const recentCompleted = recent.filter((item) => !item.abandoned);
  const recentAbandoned = recent.filter((item) => item.abandoned);

  if (recentCompleted.length >= 3) {
    suggested = Math.min(90, suggested + 5);
  }

  if (recentAbandoned.length >= 2) {
    const half = Math.floor(suggested / 2);
    if (
      profile.oftenAbandonsAfterMinute &&
      profile.oftenAbandonsAfterMinute < half
    ) {
      suggested = Math.max(10, suggested - 10);
    } else {
      suggested = Math.max(10, suggested - 5);
    }
  }

  if (hour >= 22 || hour < 6) {
    suggested = Math.max(10, Math.min(suggested, 20));
  }

  if (suggested === defaultMinutes) {
    const last = recent[0];
    if (last && !last.abandoned) {
      return {
        suggestedMinutes: suggested,
        reason: `Последний раз ты продержался ${last.actualMinutes} из ${last.plannedMinutes}. Можно так же.`,
      };
    }
    return null;
  }

  return {
    suggestedMinutes: suggested,
    reason:
      recentAbandoned.length >= 2
        ? `Недавно сессии обрывались раньше. Попробуем ${suggested} минут?`
        : `Ты стабильно закрываешь сессии. Попробуем ${suggested} минут?`,
  };
}
