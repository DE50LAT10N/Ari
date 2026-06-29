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
    384,
    settings.contextTokens - settings.maxTokens - overheadTokens - 128,
  );
}

export function fitHistoryToTokenBudget(
  history: ChatMessage[],
  budgetTokens: number,
): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let usedTokens = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    const messageTokens = estimateTextTokens(message.content) + 8;

    if (selected.length > 0 && usedTokens + messageTokens > budgetTokens) {
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
