export type GigaChatStreamSummary = {
  content: string;
  finishReason: string | null;
  eventCount: number;
  contentChunks: number;
  malformedEvents: number;
  doneSeen: boolean;
  functionCallSeen: boolean;
  reasoningSeen: boolean;
  providerError: string | null;
};

type GigaChatStreamParserOptions = {
  onContent: (content: string) => void;
  onContentChunk?: () => void;
};

type StreamChoice = {
  delta?: {
    content?: unknown;
    reasoning_content?: unknown;
    function_call?: unknown;
  };
  finish_reason?: unknown;
};

type StreamEvent = {
  choices?: StreamChoice[];
  error?: { message?: unknown } | unknown;
  message?: unknown;
};

function safeProviderError(event: StreamEvent): string | null {
  if (event.error && typeof event.error === "object") {
    const message = (event.error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 240);
    }
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return event.message.trim().slice(0, 240);
  }
  return null;
}

export function createGigaChatStreamParser(
  options: GigaChatStreamParserOptions,
): {
  push: (chunk: string) => void;
  finish: () => GigaChatStreamSummary;
  snapshot: () => GigaChatStreamSummary;
} {
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  let eventCount = 0;
  let contentChunks = 0;
  let malformedEvents = 0;
  let doneSeen = false;
  let functionCallSeen = false;
  let reasoningSeen = false;
  let providerError: string | null = null;

  const consume = (final = false) => {
    const blocks = buffer.split("\n\n");
    buffer = final ? "" : (blocks.pop() ?? "");
    for (const block of blocks) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data) continue;
      if (data === "[DONE]") {
        doneSeen = true;
        continue;
      }

      let event: StreamEvent;
      try {
        event = JSON.parse(data) as StreamEvent;
      } catch {
        malformedEvents += 1;
        continue;
      }

      eventCount += 1;
      providerError = safeProviderError(event) ?? providerError;
      const choice = event.choices?.[0];
      if (typeof choice?.finish_reason === "string") {
        finishReason = choice.finish_reason;
      }
      if (choice?.delta?.function_call) {
        functionCallSeen = true;
      }
      const reasoning = choice?.delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.trim()) {
        reasoningSeen = true;
      }
      const delta = choice?.delta?.content;
      if (typeof delta !== "string" || !delta) continue;

      content += delta;
      contentChunks += 1;
      options.onContentChunk?.();
      options.onContent(content);
    }
  };

  const snapshot = (): GigaChatStreamSummary => ({
    content,
    finishReason,
    eventCount,
    contentChunks,
    malformedEvents,
    doneSeen,
    functionCallSeen,
    reasoningSeen,
    providerError,
  });

  return {
    push(chunk) {
      buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      consume();
    },
    finish() {
      if (buffer.trim()) {
        buffer += "\n\n";
      }
      consume(true);
      return snapshot();
    },
    snapshot,
  };
}

export function describeEmptyGigaChatStream(
  summary: GigaChatStreamSummary,
): string {
  if (summary.providerError) {
    return `GigaChat завершил поток с ошибкой: ${summary.providerError}`;
  }
  switch (summary.finishReason) {
    case "blacklist":
      return "GigaChat заблокировал реплику (finish_reason=blacklist).";
    case "error":
      return "GigaChat завершил генерацию с ошибкой (finish_reason=error).";
    case "function_call":
      return "GigaChat вернул вызов функции вместо текстовой реплики.";
    case "length":
      return "GigaChat достиг лимита токенов, не вернув текст реплики.";
  }
  if (summary.reasoningSeen) {
    return "GigaChat передал рассуждение, но не вернул финальный текст.";
  }
  if (summary.malformedEvents > 0 && summary.eventCount === 0) {
    return `Поток GigaChat не удалось разобрать (${summary.malformedEvents} событий).`;
  }
  return `GigaChat завершил поток без текста (finish_reason=${summary.finishReason ?? "unknown"}).`;
}
