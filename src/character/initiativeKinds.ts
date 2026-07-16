export type InitiativeKind =
  | "check_in"
  | "break_suggestion"
  | "unfinished_thread"
  | "return_reaction"
  | "context_comment"
  | "memory_callback"
  | "news_comment"
  | "quiet_presence"
  | "screen_glance"
  | "process_advice"
  | "distraction_nudge";

const LAST_KIND_KEY = "desktop-character.initiative-kind-times.v1";

let timesCache: Partial<Record<InitiativeKind, number>> | null = null;

export function invalidateInitiativeKindCache(): void {
  timesCache = null;
}

const cooldowns: Record<InitiativeKind, number> = {
  check_in: 4 * 60 * 60_000,
  break_suggestion: 90 * 60_000,
  unfinished_thread: 6 * 60 * 60_000,
  return_reaction: 30 * 60_000,
  context_comment: 45 * 60_000,
  memory_callback: 12 * 60 * 60_000,
  news_comment: 3 * 60 * 60_000,
  quiet_presence: 10 * 60_000,
  screen_glance: 25 * 60_000,
  process_advice: 20 * 60_000,
  distraction_nudge: 10 * 60_000,
};

export function classifyInitiativeKind(description: string): InitiativeKind {
  const value = description.toLowerCase();
  if (/news|новост|что нового/i.test(value)) return "news_comment";
  if (/перерыв|около часа|долг.*работ/.test(value)) return "break_suggestion";
  if (/незаверш|открыт.*лини|намерен|срок/.test(value)) return "unfinished_thread";
  if (/вернул|возвращ/.test(value)) return "return_reaction";
  if (/окно|приложен|переключ/.test(value)) return "context_comment";
  if (/памят|эпизод|раньше/.test(value)) return "memory_callback";
  if (/визуаль|без текста|тих/.test(value)) return "quiet_presence";
  if (/снимок|экран|vision|подсмотрел|увидел на экране/.test(value)) {
    return "screen_glance";
  }
  if (/рабоч(?:ий|его) процесс|совет по делу|кратковременн/.test(value)) {
    return "process_advice";
  }
  if (/отвлёк|отвлек|вернись к фокусу|вернись к делу|distraction/.test(value)) {
    return "distraction_nudge";
  }
  return "check_in";
}

function loadTimes(): Partial<Record<InitiativeKind, number>> {
  if (timesCache) {
    return timesCache;
  }
  try {
    timesCache = JSON.parse(localStorage.getItem(LAST_KIND_KEY) ?? "{}");
    return timesCache ?? {};
  } catch {
    timesCache = {};
    return timesCache;
  }
}

export function canUseInitiativeKind(
  kind: InitiativeKind,
  options: { cooldownMs?: number; now?: number } = {},
): boolean {
  const last = loadTimes()[kind] ?? 0;
  return (
    (options.now ?? Date.now()) - last >= (options.cooldownMs ?? cooldowns[kind])
  );
}

export function markInitiativeKind(kind: InitiativeKind): void {
  const times = { ...loadTimes(), [kind]: Date.now() };
  timesCache = times;
  localStorage.setItem(LAST_KIND_KEY, JSON.stringify(times));
}

export function describeInitiativeKind(kind: InitiativeKind): string {
  return {
    news_comment: "короткая проверенная новостная искра с указанием источника",
    check_in: "редкая мягкая проверка присутствия, без обязательного вопроса",
    break_suggestion: "предложение перерыва только после действительно долгой работы",
    unfinished_thread: "возврат к одной реальной незавершённой теме",
    return_reaction: "короткая реакция на возвращение",
    context_comment: "комментарий к разрешённому приложению без притворства, что видно содержимое",
    memory_callback: "редкая естественная отсылка к релевантному эпизоду",
    quiet_presence: "визуальная реакция без сообщения",
    screen_glance:
      "редкий любопытный взгляд на разрешённый снимок экрана с короткой реакцией",
    process_advice:
      "мягкий совет по текущему рабочему процессу на основе кратковременной памяти",
    distraction_nudge:
      "мягкое напоминание вернуться к фокусу во время помодоро, без нравоучений",
  }[kind];
}
