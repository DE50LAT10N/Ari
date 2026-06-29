type RoutineProfile = {
  conversationSlots: Record<string, number>;
  appMinutes: Record<string, number>;
  updatedAt: number;
};

const ROUTINES_KEY = "desktop-character.ari-routines.v1";
const MAX_APP_ENTRIES = 20;
let routinesCache: RoutineProfile | null = null;

function emptyProfile(): RoutineProfile {
  return {
    conversationSlots: {},
    appMinutes: {},
    updatedAt: Date.now(),
  };
}

function loadProfile(): RoutineProfile {
  if (routinesCache) {
    return routinesCache;
  }
  try {
    const stored = JSON.parse(
      localStorage.getItem(ROUTINES_KEY) ?? "null",
    ) as Partial<RoutineProfile> | null;
    if (!stored) {
      routinesCache = emptyProfile();
      return routinesCache;
    }

    routinesCache = {
      conversationSlots: stored.conversationSlots ?? {},
      appMinutes: stored.appMinutes ?? {},
      updatedAt: stored.updatedAt ?? Date.now(),
    };
    return routinesCache;
  } catch {
    routinesCache = emptyProfile();
    return routinesCache;
  }
}

function saveProfile(profile: RoutineProfile): void {
  routinesCache = { ...profile, updatedAt: Date.now() };
  localStorage.setItem(ROUTINES_KEY, JSON.stringify(routinesCache));
}

function slotKey(date: Date): string {
  const part =
    date.getHours() < 6
      ? "night"
      : date.getHours() < 12
        ? "morning"
        : date.getHours() < 18
          ? "day"
          : "evening";
  return `${date.getDay()}:${part}`;
}

export function recordConversationMoment(date = new Date()): void {
  const profile = loadProfile();
  const key = slotKey(date);
  profile.conversationSlots[key] =
    Math.min(1000, (profile.conversationSlots[key] ?? 0) + 1);
  saveProfile(profile);
}

export function recordActivitySession(
  processName: string,
  durationMs: number,
): void {
  const normalized = processName.trim();
  const minutes = Math.round(durationMs / 60_000);
  if (!normalized || minutes < 2) return;

  const profile = loadProfile();
  profile.appMinutes[normalized] =
    Math.min(100_000, (profile.appMinutes[normalized] ?? 0) + minutes);
  profile.appMinutes = Object.fromEntries(
    Object.entries(profile.appMinutes)
      .sort(([, left], [, right]) => right - left)
      .slice(0, MAX_APP_ENTRIES),
  );
  saveProfile(profile);
}

export function describeRoutineContext(date = new Date()): string {
  const profile = loadProfile();
  const currentSlotCount = profile.conversationSlots[slotKey(date)] ?? 0;
  const topApps = Object.entries(profile.appMinutes)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3);
  const details: string[] = [];

  if (currentSlotCount >= 3) {
    details.push(
      `пользователь уже ${currentSlotCount} раз общался с Ari в похожее время недели`,
    );
  }
  if (topApps.length) {
    details.push(
      `по агрегированной длительности заметны приложения: ${topApps
        .map(([name, minutes]) => `${name} — около ${minutes} мин`)
        .join(", ")}`,
    );
  }

  return details.length
    ? details.join("; ")
    : "устойчивые привычки пока не сформировались";
}
