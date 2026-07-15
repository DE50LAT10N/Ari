import type { ChatMessage } from "../types/chat";
import type { RuntimeContext } from "../character/promptBuilder";
import { buildMessages } from "../character/promptBuilder";
import type { AppSettings } from "../settings/appSettings";

const ASCII_CHARS_PER_TOKEN = 3;
const NON_ASCII_CHARS_PER_TOKEN = 2.2;
const TOKEN_OVERHEAD = 4;

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
