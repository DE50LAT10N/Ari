import { fetch } from "@tauri-apps/plugin-http";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import { logError } from "../platform/logger";
import { resolveModel, type ModelTask } from "./modelRouter";
import { expandOllamaModelNames } from "./ollamaCatalog";
import { formatOllamaError } from "./ollamaErrors";
import type { CharacterEmotion } from "../types/character";
import {
  parseEmotionFromContent,
  stripEmotionMarkup,
} from "../character/emotionTags";

type OllamaStreamChunk = {
  message?: {
    content?: unknown;
  };
  done?: boolean;
  done_reason?: unknown;
  error?: unknown;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: unknown;
  }>;
};

type OllamaVersionResponse = {
  version?: unknown;
};

type OllamaPsResponse = {
  models?: Array<{
    name?: unknown;
    size?: unknown;
    size_vram?: unknown;
    context_length?: unknown;
    expires_at?: unknown;
  }>;
};

export type OllamaRunningModel = {
  name: string;
  size: number;
  sizeVram: number;
  contextLength: number;
  expiresAt?: string;
};

export type OllamaStatus = {
  online: boolean;
  version?: string;
  models: string[];
  runningModels: OllamaRunningModel[];
  error?: string;
};

type OllamaChatResponse = {
  message?: {
    content?: unknown;
  };
  error?: unknown;
};

function createHttpError(status: number, responseText: string): Error {
  return formatOllamaError(status, responseText);
}

export { expandOllamaModelNames, isOllamaModelAvailable, needsOllamaModelCatalog } from "./ollamaCatalog";

export async function checkOllamaStatus(
  baseUrl: string,
): Promise<OllamaStatus> {
  try {
    const [versionResponse, tagsResponse, psResponse] = await Promise.all([
      fetch(`${baseUrl}/api/version`),
      fetch(`${baseUrl}/api/tags`),
      fetch(`${baseUrl}/api/ps`).catch(() => null),
    ]);

    if (!versionResponse.ok || !tagsResponse.ok) {
      return {
        online: false,
        models: [],
        runningModels: [],
        error: `HTTP ${versionResponse.status}/${tagsResponse.status}`,
      };
    }

    const versionData =
      (await versionResponse.json()) as OllamaVersionResponse;
    const tagsData = (await tagsResponse.json()) as OllamaTagsResponse;
    const rawModels =
      tagsData.models
        ?.map(({ name }) => (typeof name === "string" ? name : ""))
        .filter(Boolean) ?? [];
    const models = expandOllamaModelNames(rawModels);

    let runningModels: OllamaRunningModel[] = [];
    if (psResponse?.ok) {
      const psData = (await psResponse.json()) as OllamaPsResponse;
      runningModels =
        psData.models
          ?.map((model): OllamaRunningModel | null => {
            if (typeof model.name !== "string") {
              return null;
            }

            return {
              name: model.name,
              size: typeof model.size === "number" ? model.size : 0,
              sizeVram:
                typeof model.size_vram === "number" ? model.size_vram : 0,
              contextLength:
                typeof model.context_length === "number"
                  ? model.context_length
                  : 0,
              expiresAt:
                typeof model.expires_at === "string"
                  ? model.expires_at
                  : undefined,
            };
          })
          .filter(
            (model): model is OllamaRunningModel => model !== null,
          ) ?? [];
    }

    return {
      online: true,
      version:
        typeof versionData.version === "string"
          ? versionData.version
          : undefined,
      models,
      runningModels,
    };
  } catch (error) {
    return {
      online: false,
      models: [],
      runningModels: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function controlOllamaModel(
  baseUrl: string,
  body: object,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw createHttpError(
      response.status,
      await response.text().catch(() => ""),
    );
  }
}

export function loadOllamaModel(
  baseUrl: string,
  model: string,
  contextTokens: number,
): Promise<void> {
  return controlOllamaModel(baseUrl, {
    model,
    keep_alive: -1,
    options: {
      num_ctx: contextTokens,
    },
  });
}

export function unloadOllamaModel(
  baseUrl: string,
  model: string,
): Promise<void> {
  return controlOllamaModel(baseUrl, {
    model,
    keep_alive: 0,
  });
}

export async function completeLocalLlmJson<T>(
  messages: ChatMessage[],
  settings: AppSettings,
  maxTokens = 256,
  task: ModelTask = "json",
): Promise<T> {
  const model = resolveModel(task, settings);
  const response = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: false,
      format: "json",
      options: {
        temperature: 0.1,
        num_predict: maxTokens,
        num_ctx: Math.min(settings.contextTokens, 4096),
      },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as OllamaChatResponse;

  if (!response.ok) {
    throw createHttpError(
      response.status,
      typeof body.error === "string" ? body.error : "",
    );
  }

  if (typeof body.message?.content !== "string") {
    throw new Error("Ollama вернула пустой структурированный ответ.");
  }

  return JSON.parse(body.message.content) as T;
}

export async function streamLocalLlm(
  messages: ChatMessage[],
  settings: AppSettings,
  onUpdate: (content: string) => void,
  onEmotion: (emotion: CharacterEmotion) => void,
  signal: AbortSignal,
): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: true,
        think: false,
        options: {
          temperature: settings.temperature,
          num_predict: settings.maxTokens,
          num_ctx: settings.contextTokens,
        },
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new DOMException("Запрос остановлен", "AbortError");
    }

    const detail = error instanceof Error ? error.message : String(error);
    logError("Ollama streaming request failed", error);
    throw new Error(
      `Не удалось подключиться к Ollama. Убедитесь, что сервер запущен. ${detail}`,
    );
  }

  if (!response.ok) {
    const httpError = createHttpError(
      response.status,
      await response.text().catch(() => ""),
    );
    logError("Ollama returned an HTTP error", httpError);
    throw httpError;
  }

  if (!response.body) {
    throw new Error("Ollama не предоставила поток ответа.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawContent = "";
  let visibleContent = "";
  let detectedEmotion: CharacterEmotion | null = null;
  let doneReason: unknown;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let chunk: OllamaStreamChunk;
      try {
        chunk = JSON.parse(line) as OllamaStreamChunk;
      } catch {
        continue;
      }

      if (typeof chunk.error === "string") {
        throw new Error(chunk.error);
      }

      const token = chunk.message?.content;
      if (typeof token === "string") {
        rawContent += token;
        const emotion = parseEmotionFromContent(rawContent);

        if (emotion && emotion !== detectedEmotion) {
          detectedEmotion = emotion;
          onEmotion(emotion);
        }

        const cleaned = stripEmotionMarkup(rawContent);

        if (cleaned !== visibleContent) {
          visibleContent = cleaned;
          onUpdate(visibleContent);
        }
      }

      if (chunk.done) {
        doneReason = chunk.done_reason;
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer) as OllamaStreamChunk;
      const token = chunk.message?.content;
      if (typeof token === "string") {
        rawContent += token;
        const emotion = parseEmotionFromContent(rawContent);
        if (emotion && emotion !== detectedEmotion) {
          detectedEmotion = emotion;
          onEmotion(emotion);
        }
        visibleContent = stripEmotionMarkup(rawContent);
        onUpdate(visibleContent);
      }
      doneReason = chunk.done_reason ?? doneReason;
    } catch {
      // ignore trailing partial chunk
    }
  }

  const finalContent = stripEmotionMarkup(rawContent).trim();

  if (!finalContent) {
    if (doneReason === "length") {
      throw new Error(
        `Ollama исчерпала лимит ${settings.maxTokens} токенов до формирования ответа.`,
      );
    }

    throw new Error("Ollama вернула пустой ответ.");
  }

  return finalContent;
}
