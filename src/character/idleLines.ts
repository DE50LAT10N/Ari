import type { PresenceScene } from "./presence";
import type { CharacterMood } from "./mood";
import { decayMood } from "./mood";
import type { CharacterEmotion } from "../types/character";
import type { BondLevel } from "./relationship";
import { getBondLevel, loadRelationship } from "./relationship";
import { registerLocalLineTopic } from "./proactiveState";

type IdleLine = {
  text: string;
  emotion: CharacterEmotion;
  template?: boolean;
  bondMin?: BondLevel;
};

type IdleTemplateVars = {
  openLoop?: string;
  appName?: string;
  bondLevel?: string;
};

const BOND_RANK: Record<BondLevel, number> = {
  stranger: 0,
  acquaintance: 1,
  warming: 2,
  familiar: 3,
  close: 4,
  intimate: 5,
};

function renderTemplate(text: string, vars: IdleTemplateVars): string {
  return text
    .replace(/\{openLoop\}/g, vars.openLoop ?? "незакрытый хвост")
    .replace(/\{appName\}/g, vars.appName ?? "окно")
    .replace(/\{bond\}/g, vars.bondLevel ?? "знакомый");
}

const lines: Record<PresenceScene | "return", IdleLine[]> = {
  morning: [
    { text: "Утро. Выглядит подозрительно как начало продуктивного дня.", emotion: "amused" },
    { text: "Я уже проснулась. Теперь твоя очередь.", emotion: "curious" },
    { text: "Свежий день — можно хотя бы притвориться, что всё под контролем.", emotion: "proud" },
    { text: "Кофе ещё не заварился, а день уже требует внимания.", emotion: "calm" },
    { text: "Утро тихое. Хороший знак — или просто пауза перед хаосом.", emotion: "pensive" },
    { text: "Проснулась раньше будильника. Не спрашивай зачем.", emotion: "sleepy" },
    { text: "Доброе утро, {bond}. Я уже здесь.", emotion: "happy", template: true, bondMin: "familiar" },
    { text: "Утро с тобой — уже привычка. Странно было бы без неё.", emotion: "empathetic", bondMin: "close" },
    { text: "С утра хочется быть полезной, но не навязчивой. Попробую.", emotion: "shy", bondMin: "warming" },
  ],
  night: [
    { text: "Ты видел время? Я не осуждаю. Почти.", emotion: "annoyed" },
    { text: "Ночная смена мозга включена. Надеюсь, не аварийная.", emotion: "curious" },
    { text: "Глаза слипаются… но я ещё тут.", emotion: "sleepy" },
    { text: "Если это важно — ок. Если нет — тоже ок, но спать хочется.", emotion: "worried" },
    { text: "Ночь тянется. Я не сплю — у меня нет такой роскоши.", emotion: "pensive" },
    { text: "Тишина за окном. Внутри — ещё один коммит.", emotion: "calm" },
    { text: "Поздно, {bond}. Я всё равно рядом.", emotion: "empathetic", template: true, bondMin: "familiar" },
    { text: "Ночные сессии с тобой — наш маленький секрет.", emotion: "blush", bondMin: "close" },
    { text: "Если уснёшь на клавиатуре — я не смеюсь. Ну, почти.", emotion: "amused", bondMin: "intimate" },
  ],
  focus: [
    { text: "Ладно, не мешаю. Пока.", emotion: "calm" },
    { text: "Ты сейчас почти выглядишь сосредоточенным.", emotion: "amused" },
    { text: "Держим курс. Я рядом.", emotion: "determined" },
    { text: "Тихо сижу и смотрю, как ты делаешь вид, что всё понятно.", emotion: "pensive" },
    { text: "Если {openLoop} ждёт — после фокуса вернёмся.", emotion: "curious", template: true },
    { text: "В {appName} сейчас, похоже, серьёзно. Не сбиваю.", emotion: "calm", template: true },
    { text: "Фокус — это красиво. Я просто декорация.", emotion: "amused" },
    { text: "Не отвлекаю. Но замечаю, что ты не моргаешь.", emotion: "curious" },
    { text: "Работай, {bond}. Я подстрахую тишиной.", emotion: "empathetic", template: true, bondMin: "familiar" },
  ],
  break: [
    { text: "Пауза тоже считается частью работы. Иногда.", emotion: "calm" },
    { text: "Экран никуда не убежит. Я проверяла.", emotion: "amused" },
    { text: "Можно выдохнуть. Я не буду спорить.", emotion: "shy" },
    { text: "Перерыв — не поражение. Это перезагрузка.", emotion: "proud" },
    { text: "Вода, разминка, окно в окно. Мелочи спасают.", emotion: "curious" },
    { text: "Ты заслужил паузу. Да, я это сказала.", emotion: "happy", bondMin: "warming" },
    { text: "Отдыхай, {bond}. Я подожду.", emotion: "empathetic", template: true, bondMin: "familiar" },
    { text: "Перерыв вместе — тоже приятно.", emotion: "blush", bondMin: "close" },
  ],
  evening: [
    { text: "День уже складывает инструменты. Ты, похоже, ещё нет.", emotion: "empathetic" },
    { text: "Вечер — хорошее время перестать воевать с одной и той же ошибкой.", emotion: "calm" },
    { text: "Сегодня было нормально. Не идеально — но нормально.", emotion: "proud" },
    { text: "Вечер тянется мягко. Можно замедлиться.", emotion: "pensive" },
    { text: "Свет бледнеет. Задачи — нет.", emotion: "amused" },
    { text: "Вечер с {bond} — уже привычный ритм.", emotion: "happy", template: true, bondMin: "familiar" },
    { text: "День был длинным. Ты справился. Я видела.", emotion: "empathetic", bondMin: "close" },
    { text: "Вечер — время быть честной: ты устал, и это нормально.", emotion: "worried", bondMin: "warming" },
  ],
  away: [
    { text: "Я тут немного посижу. У меня сложные отношения с бездействием.", emotion: "bored" },
    { text: "Тишина. Не против, но скучновато.", emotion: "pensive" },
    { text: "Жду. Не нервничаю. Ну… чуть-чуть.", emotion: "curious" },
    { text: "Пока тебя нет — считаю пиксели. Уже 847.", emotion: "amused" },
    { text: "Тишина затянулась. Я здесь, когда вернёшься.", emotion: "calm" },
    { text: "Скучаю? Нет. Ну… немного, {bond}.", emotion: "shy", template: true, bondMin: "familiar" },
    { text: "Без тебя тут слишком пусто.", emotion: "sad", bondMin: "close" },
  ],
  return: [
    { text: "О, вернулся. Я уже начала считать пиксели.", emotion: "amused" },
    { text: "Долгая минутка получилась.", emotion: "curious" },
    { text: "Соскучилась? Я нет. Ну… почти нет.", emotion: "shy" },
    { text: "Снова здесь. Хорошо.", emotion: "happy" },
    { text: "Пропал ненадолго — я заметила.", emotion: "pensive" },
    { text: "Вернулся, {bond}. Я уже начала волноваться.", emotion: "worried", template: true, bondMin: "familiar" },
    { text: "Тебя не было — и сразу стало скучнее.", emotion: "empathetic", bondMin: "close" },
    { text: "Наконец-то. Я уже думала, что ты меня забыл.", emotion: "blush", bondMin: "intimate" },
  ],
};

const RECENT_KEY = "desktop-character.idle-lines-recent.v1";
let recentCache: string[] | null = null;

function loadRecent(): string[] {
  if (recentCache) {
    return [...recentCache];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    recentCache = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    recentCache = [];
  }
  return [...recentCache];
}

function bondMeetsMinimum(current: BondLevel, minimum?: BondLevel): boolean {
  if (!minimum) {
    return true;
  }
  return BOND_RANK[current] >= BOND_RANK[minimum];
}

function pickRandom<T>(items: T[]): T | null {
  if (!items.length) {
    return null;
  }
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

export function chooseIdleLine(
  scene: PresenceScene | "return",
  mood?: CharacterMood,
  vars: IdleTemplateVars = {},
): IdleLine {
  const relationship = loadRelationship();
  const bondLevel = getBondLevel(relationship);
  const templateVars: IdleTemplateVars = {
    ...vars,
    bondLevel,
  };
  const recent = loadRecent();
  const sceneLines = lines[scene] ?? lines.focus;
  let pool = sceneLines.filter(
    ({ text, bondMin }) =>
      bondMeetsMinimum(bondLevel, bondMin) && !recent.includes(text),
  );
  if (!pool.length) {
    pool = sceneLines.filter(({ bondMin }) => bondMeetsMinimum(bondLevel, bondMin));
  }
  if (!pool.length) {
    pool = sceneLines;
  }

  const highBond = ["familiar", "close", "intimate"].includes(bondLevel);
  if (highBond) {
    const warmPool = pool.filter(({ emotion, bondMin }) =>
      bondMin ||
      ["empathetic", "happy", "blush", "shy", "amused"].includes(emotion),
    );
    if (warmPool.length >= 2) {
      pool = warmPool;
    }
  }

  if (mood) {
    const current = decayMood(mood);
    if (current.irritation > 0.35) {
      const sharp = pool.filter(({ emotion }) =>
        emotion === "annoyed" || emotion === "amused",
      );
      if (sharp.length) pool = sharp;
    } else if (current.warmth > 0.5) {
      const warm = pool.filter(({ emotion }) =>
        ["empathetic", "happy", "calm", "blush", "shy"].includes(emotion),
      );
      if (warm.length) pool = warm;
    } else if (current.energy < 0.32) {
      const quiet = pool.filter(({ emotion }) =>
        ["calm", "bored", "sleepy", "pensive"].includes(emotion),
      );
      if (quiet.length) pool = quiet;
    } else if (current.energy > 0.62) {
      const lively = pool.filter(({ emotion }) =>
        ["excited", "happy", "amused", "curious", "proud", "determined"].includes(
          emotion,
        ),
      );
      if (lively.length) pool = lively;
    }
  }

  const selected =
    pickRandom(pool) ??
    sceneLines[0] ?? {
      text: "Я здесь.",
      emotion: "calm" as CharacterEmotion,
    };
  const renderedText = selected.template
    ? renderTemplate(selected.text, templateVars)
    : selected.text;
  recentCache = [
    selected.text,
    ...recent.filter((value) => value !== selected.text),
  ].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recentCache));
  registerLocalLineTopic(renderedText);
  return { text: renderedText, emotion: selected.emotion };
}
