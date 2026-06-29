import type { CharacterEmotion } from "../types/character";

type CommandFrame = {
  intro?: string;
  emotion: CharacterEmotion;
  /** If true, body is shown as-is without intro (short character replies). */
  bodyOnly?: boolean;
};

const COMMAND_FRAMES: Record<string, CommandFrame> = {
  "set-project": {
    intro: "Записала. Этот проект теперь наш рабочий уголок:",
    emotion: "happy",
  },
  "attach-readme": {
    emotion: "curious",
    bodyOnly: true,
  },
  "recent-files": {
    intro: "Вот что недавно шевелилось в проекте:",
    emotion: "curious",
  },
  "test-plan": {
    intro: "Набросала план — смотри, не забудь закинуть в backlog:",
    emotion: "happy",
  },
  "goal-vs-todo": {
    intro: "Сверила цель с тем, что ещё висит:",
    emotion: "curious",
  },
  "backlog-add": { emotion: "happy", bodyOnly: true },
  "task-add": { emotion: "happy", bodyOnly: true },
  "task-list": { intro: "Заглянула в дела — вот что висит:", emotion: "curious" },
  "task-next": { emotion: "curious", bodyOnly: true },
  "task-complete": { emotion: "happy", bodyOnly: true },
  "task-defer": { emotion: "calm", bodyOnly: true },
  "backlog-next": { emotion: "curious", bodyOnly: true },
  "backlog-privacy": {
    intro: "По privacy пока вот что открыто — без паники:",
    emotion: "calm",
  },
  "backlog-defer": { emotion: "calm", bodyOnly: true },
  "git-status": {
    intro: "Заглянула в git — картина такая:",
    emotion: "curious",
  },
  "git-log": {
    intro: "Последние коммиты, как просил:",
    emotion: "curious",
  },
  "git-diff": {
    intro: "Diff на столе — смотри:",
    emotion: "curious",
  },
  "daily-review": {
    intro: "Пробежалась по дню. Вот что наметилось:",
    emotion: "calm",
  },
  "weekly-review": {
    intro: "Неделя в целом выглядела так:",
    emotion: "calm",
  },
  capabilities: {
    intro: "Коротко, что я умею — без лекции:",
    emotion: "proud",
  },
};

export function wrapCommandReply(
  command: string,
  body: string,
): { reply: string; emotion: CharacterEmotion } {
  const frame = COMMAND_FRAMES[command] ?? { emotion: "curious" as const };
  if (frame.bodyOnly || !frame.intro) {
    return { reply: body, emotion: frame.emotion };
  }
  return {
    reply: `${frame.intro}\n\n${body}`,
    emotion: frame.emotion,
  };
}
