/**
 * Detects homework / interview / algorithm problem pastes and help requests
 * that should be treated as technical tasks, not casual banter.
 */

const HELP_REQUEST_PATTERN =
  /(?:помоги|поможешь|можешь\s+помочь|help\s+(?:me\s+)?(?:with|solve)|solve\s+this|разбер(?:и|ём|ем)\s+(?:со\s+мной\s+)?(?:эту\s+)?задач|реши(?:ть)?\s+(?:эту\s+)?задач|напиши\s+(?:функцию|код|решение)|how\s+(?:do\s+i|to)\s+solve)/i;

const PROBLEM_STATEMENT_MARKERS =
  /(?:\bleetcode\b|\bhacker\s*rank\b|\bcodemirror\b|\binterview\b|\bgiven\s+(?:an?\s+|two\s+|the\s+)?|\byou\s+are\s+given\b|\breturn\s+the\b|\bconstraints?\b|\bexample\s*\d*\b|\binput:\b|\boutput:\b|\blinked\s+lists?\b|\btime\s+complexity\b|\bspace\s+complexity\b|\bnon-?negative\s+integers?\b|\bnon-?empty\b|\barray\s+of\s+integers?\b|\bwrite\s+a\s+function\b|\bimplement\s+(?:a\s+)?(?:function|class|algorithm)\b|условие\s+задач|входные\s+данные|выходные\s+данные|пример\s*\d*|ограничени[яе]|сложность\s+(?:по\s+)?времени|связн(?:ый|ых)\s+список|напиши\s+функцию|реши\s+задачу|помоги\s+с\s+(?:этой\s+)?задач)/i;

const STRUCTURED_PASTE_MARKERS =
  /(?:example\s*\d+|input\s*:|output\s*:|constraints?\s*:|explanation\s*:|пример\s*\d+|вход\s*:|выход\s*:|ограничени)/i;

const CONTINUATION_FOLLOW_UP_PATTERN =
  /(?:^|[\s,.;:!?])(?:продолж\p{L}*|дальше|а\s+(?:это|код|решение|подход)|сделай|реши|докажи|напиши|покажи\s+код|а\s+как|и\s+что\s+дальше|finish|continue|next\s+step|go\s+on)(?:$|[\s,.;:!?])/iu;

const DEICTIC_SHORT_FOLLOW_UP =
  /(?:^(?:а\s+)?(?:это|то|ту|её|ее|его|их)(?:$|[\s,.;:!?])|^(?:и\s+)?(?:что|как)\s+(?:с\s+)?(?:этим|тем|ним)(?:$|[\s,.;:!?]))/iu;

/** Short go-ahead that continues an offered/open task — not "давай просто поговорим". */
const AFFIRMATIVE_CONTINUATION_PATTERN =
  /^(?:давай|давай\s+(?:разбер(?:ём|ем)|сделаем|решим|поехали)|да|ага|угу|ок|окей|го|поехали|ну\s+давай|let'?s\s+go|sure|ok|okay)[.!?…]*$/iu;

const CHAT_NOT_TASK_AFFIRMATIVE =
  /(?:просто\s+поговор|поболтать|поболтаем|не\s+про\s+задач|без\s+задач)/i;

const ASSISTANT_OPEN_TASK_OFFER =
  /(?:цифр\p{L}*\s+в\s+обратн|обратн\p{L}*\s+порядк|linked\s+list|leetcode|литкод|давай\s+разбер|разбер(?:ём|ем)ся|реш(?:ать|им)\s+задач|услови(?:е|я)\s+задач|add\s+the\s+two|non-?empty\s+linked)/iu;

const OPEN_TASK_LOOKBACK = 8;

export type ChatTurnLike = { role: string; content: string };

export function looksLikeHelpRequest(message: string): boolean {
  const text = message.trim();
  if (!text) {
    return false;
  }
  return HELP_REQUEST_PATTERN.test(text);
}

export function looksLikeTaskOrProblemStatement(message: string): boolean {
  const text = message.trim();
  if (!text) {
    return false;
  }
  if (PROBLEM_STATEMENT_MARKERS.test(text)) {
    return true;
  }
  if (looksLikeHelpRequest(text) && /задач|problem|leetcode|algorithm|код|function|class/i.test(text)) {
    return true;
  }
  // Long structured paste (LeetCode-style) without requiring a question mark.
  if (text.length >= 200 && STRUCTURED_PASTE_MARKERS.test(text)) {
    return true;
  }
  if (
    text.length >= 280 &&
    /(?:\b(?:integer|array|string|node|list|matrix|graph|tree)\b|массив|строк[аи]|дерево|граф)/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function looksLikeAffirmativeContinuation(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 48) {
    return false;
  }
  if (CHAT_NOT_TASK_AFFIRMATIVE.test(text)) {
    return false;
  }
  return AFFIRMATIVE_CONTINUATION_PATTERN.test(text);
}

export function looksLikeShortSolveRequest(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 80) {
    return false;
  }
  return /(?:реши(?:ть)?\s+задач|решим\s+задач|давай\s+задач|solve\s+(?:the\s+)?(?:task|problem|it))/i.test(
    text,
  );
}

export function looksLikeContinuationFollowUp(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > 120) {
    return false;
  }
  if (looksLikeAffirmativeContinuation(text)) {
    return true;
  }
  if (looksLikeShortSolveRequest(text)) {
    return true;
  }
  if (CONTINUATION_FOLLOW_UP_PATTERN.test(text)) {
    return true;
  }
  if (text.length < 90 && DEICTIC_SHORT_FOLLOW_UP.test(text)) {
    return true;
  }
  return false;
}

export function findOpenTaskInHistory(
  history: ChatTurnLike[],
  lookback = OPEN_TASK_LOOKBACK,
): { content: string; role: "user" | "assistant" } | null {
  const recent = history.slice(-lookback);
  let assistantOffer: { content: string; role: "assistant" } | null = null;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    if (!turn?.content?.trim()) {
      continue;
    }
    if (turn.role === "user" && looksLikeTaskOrProblemStatement(turn.content)) {
      return { content: turn.content, role: "user" };
    }
    if (
      !assistantOffer &&
      turn.role === "assistant" &&
      ASSISTANT_OPEN_TASK_OFFER.test(turn.content)
    ) {
      assistantOffer = { content: turn.content, role: "assistant" };
    }
  }
  return assistantOffer;
}

export function shouldContinueOpenTask(
  message: string,
  history?: ChatTurnLike[],
): boolean {
  if (!history?.length) {
    return false;
  }
  if (!findOpenTaskInHistory(history)) {
    return false;
  }
  return (
    looksLikeContinuationFollowUp(message) ||
    looksLikeHelpRequest(message) ||
    looksLikeShortSolveRequest(message) ||
    looksLikeAffirmativeContinuation(message)
  );
}

/**
 * True when the current message is a task, a paste after help request, or a
 * short follow-up continuing an open task already in history.
 */
export function userPresentedTask(
  message: string,
  previousUserMessage?: string,
  history?: ChatTurnLike[],
): boolean {
  if (looksLikeTaskOrProblemStatement(message)) {
    return true;
  }
  if (
    previousUserMessage &&
    looksLikeHelpRequest(previousUserMessage) &&
    message.trim().length >= 80
  ) {
    return true;
  }
  if (shouldContinueOpenTask(message, history)) {
    return true;
  }
  return false;
}

export function previousUserMessageFromHistory(
  history: ChatTurnLike[],
  currentUserMessage: string,
): string | undefined {
  const userTurns = history.filter((message) => message.role === "user");
  if (userTurns.length === 0) {
    return undefined;
  }
  const last = userTurns[userTurns.length - 1];
  if (last && last.content === currentUserMessage && userTurns.length >= 2) {
    return userTurns[userTurns.length - 2]?.content;
  }
  if (last && last.content !== currentUserMessage) {
    return last.content;
  }
  if (userTurns.length >= 2) {
    return userTurns[userTurns.length - 2]?.content;
  }
  return undefined;
}
