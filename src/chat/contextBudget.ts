import type { ChatMessage } from "../types/chat";
import type { RuntimeContext } from "../character/promptBuilder";
import { buildMessages } from "../character/promptBuilder";
import type { AppSettings } from "../settings/appSettings";

const ASCII_CHARS_PER_TOKEN = 3;
const NON_ASCII_CHARS_PER_TOKEN = 2.2;
const TOKEN_OVERHEAD = 4;

/** Minimum dialogue turns to keep under token pressure (user+assistant pairs count as messages). */
export const HISTORY_FLOOR_MIN_MESSAGES = 2;
/** Soft token reserve for recent history before wiping older turns / ambient context. */
export const HISTORY_FLOOR_TOKEN_RESERVE = 1600;

export function estimateTextTokens(text: string): number {
  let nonAscii = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      nonAscii += 1;
    }
  }
  const ascii = text.length - nonAscii;
  const tokens =
    ascii / ASCII_CHARS_PER_TOKEN + nonAscii / NON_ASCII_CHARS_PER_TOKEN;
  return Math.ceil(tokens) + TOKEN_OVERHEAD;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateTextTokens(message.content) + 4,
    0,
  );
}

export function measurePromptOverhead(
  fittedHistory: ChatMessage[],
  runtimeContext?: RuntimeContext,
): number {
  const messages = buildMessages(fittedHistory, runtimeContext);
  return estimateMessagesTokens(messages) - estimateMessagesTokens(fittedHistory);
}

export function computeHistoryBudget(
  settings: AppSettings,
  overheadTokens: number,
): number {
  return Math.max(
    0,
    settings.contextTokens - settings.maxTokens - overheadTokens - 128,
  );
}

export function truncateTextToTokenBudget(
  text: string,
  budgetTokens: number,
): string {
  if (!text || budgetTokens <= TOKEN_OVERHEAD) {
    return "";
  }
  if (estimateTextTokens(text) <= budgetTokens) {
    return text;
  }

  let low = 0;
  let high = text.length;
  let best = "";
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = `${text.slice(0, midpoint).trimEnd()}…`;
    if (estimateTextTokens(candidate) <= budgetTokens) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }
  return best;
}

export function fitHistoryToTokenBudget(
  history: ChatMessage[],
  budgetTokens: number,
): ChatMessage[] {
  if (budgetTokens <= 0) {
    return [];
  }
  const selected: ChatMessage[] = [];
  let usedTokens = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const messageTokens = estimateTextTokens(message.content) + 8;

    if (usedTokens + messageTokens > budgetTokens) {
      if (selected.length === 0) {
        const content = truncateTextToTokenBudget(
          message.content,
          Math.max(0, budgetTokens - 8),
        );
        if (content) {
          selected.unshift({ ...message, content });
        }
      }
      break;
    }

    selected.unshift(message);
    usedTokens += messageTokens;
  }

  while (selected[0]?.role === "assistant") {
    selected.shift();
  }

  return selected.map(({ role, content }) => ({ role, content }));
}

/**
 * Keep at least the newest user turn (truncated if needed). Never returns [] when history is non-empty.
 * Prefer also keeping the previous assistant turn when budget allows.
 */
export function preserveMinimumHistory(
  history: ChatMessage[],
  budgetTokens: number,
): ChatMessage[] {
  if (history.length === 0) {
    return [];
  }

  const fitted = fitHistoryToTokenBudget(history, Math.max(budgetTokens, 1));
  if (fitted.length > 0) {
    return fitted;
  }

  // Budget was too small even for one message — force-truncate the last user turn.
  let lastUserIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) {
    const last = history[history.length - 1]!;
    const content = truncateTextToTokenBudget(last.content, Math.max(32, budgetTokens));
    return content
      ? [{ role: last.role, content }]
      : [{ role: last.role, content: last.content.slice(0, 80) }];
  }

  const lastUser = history[lastUserIndex]!;
  const content = truncateTextToTokenBudget(
    lastUser.content,
    Math.max(48, budgetTokens > 0 ? budgetTokens : 48),
  );
  const result: ChatMessage[] = [
    {
      role: "user",
      content: content || lastUser.content.slice(0, 120),
    },
  ];

  // Optionally prepend previous assistant if any budget remains.
  if (lastUserIndex > 0 && history[lastUserIndex - 1]?.role === "assistant") {
    const prev = history[lastUserIndex - 1]!;
    const used = estimateTextTokens(result[0]!.content) + 8;
    const remaining = Math.max(0, budgetTokens - used);
    if (remaining > 40) {
      const prevContent = truncateTextToTokenBudget(prev.content, remaining - 8);
      if (prevContent) {
        result.unshift({ role: "assistant", content: prevContent });
      }
    }
  }

  return result;
}

export function historyFloorMessageCount(historyLength: number): number {
  return Math.min(HISTORY_FLOOR_MIN_MESSAGES, Math.max(1, historyLength));
}
