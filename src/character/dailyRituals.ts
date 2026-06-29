export type DailyRitual = "morning" | "midday" | "evening";

const RITUAL_KEY = "desktop-character.daily-rituals.v1";

type RitualState = Partial<Record<DailyRitual, string>>;

let ritualStateCache: RitualState | null = null;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function loadState(): RitualState {
  if (ritualStateCache) {
    return ritualStateCache;
  }
  try {
    ritualStateCache = JSON.parse(
      localStorage.getItem(RITUAL_KEY) ?? "{}",
    ) as RitualState;
    return ritualStateCache;
  } catch {
    ritualStateCache = {};
    return ritualStateCache;
  }
}

export function getPendingDailyRitual(
  date = new Date(),
): DailyRitual | null {
  const hour = date.getHours();
  const weekend = isWeekend(date);
  const ritual =
    hour >= 8 && hour < 12
      ? "morning"
      : hour >= 12 && hour < 15
        ? "midday"
        : hour >= 18 && hour < 22
          ? "evening"
          : null;
  if (!ritual) return null;
  if (loadState()[ritual] === dateKey(date)) {
    return null;
  }
  if (weekend && ritual === "midday") {
    return null;
  }
  return ritual;
}

export function describeRitualTone(
  ritual: DailyRitual,
  bondLevel = "acquaintance",
  weekend = false,
): string {
  const warm = ["familiar", "close", "intimate"].includes(bondLevel);
  if (ritual === "morning") {
    return weekend
      ? warm
        ? "выходное утро — мягче, без давления на продуктивность"
        : "утро выходного — можно не спешить"
      : warm
        ? "рабочее утро — тёплое, но по делу"
        : "утро буднего дня — бодро и без слащавости";
  }
  if (ritual === "midday") {
    return weekend
      ? "полдень выходного — лёгкая проверка «как день»"
      : "середина дня — короткий чек-ин, не отвлекать надолго";
  }
  return weekend
    ? "вечер выходного — подвести день без отчёта"
    : "вечер буднего — мягко закрыть день";
}

export function markDailyRitualAttempted(
  ritual: DailyRitual,
  date = new Date(),
): void {
  ritualStateCache = { ...loadState(), [ritual]: dateKey(date) };
  localStorage.setItem(RITUAL_KEY, JSON.stringify(ritualStateCache));
}
