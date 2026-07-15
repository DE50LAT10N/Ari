import {
  gigaChatFetch as fetch,
  gigaChatStream,
} from "../platform/gigaChatHttp";
import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import type { CharacterEmotion } from "../types/character";
import {
  parseEmotionFromContent,
  stripEmotionMarkup,
} from "../character/emotionTags";
import { loadGigaChatAuthKey } from "../platform/gigaChatCredentials";
import {
  recordGigaChatFailure,
  recordGigaChatSuccess,
  setGigaChatAuthKeyPresent,
} from "./gigaChatStatus";
import type { ScreenCapture } from "../platform/screenCapture";
import {
  resolveModel,
  resolveSynthesisModel,
  type ModelTask,
} from "./modelRouter";
import {
  enqueueGigaChatRequest,
  recordGigaChatThrottle,
} from "./gigaChatRateLimit";
import { sanitizeBase64ImagePayload } from "./imagePayloadParser";
import { TimeoutError } from "../platform/asyncTimeout";
import {
  createGigaChatStreamParser,
  describeEmptyGigaChatStream,
} from "./gigaChatStreamParser";
import { recordGigaChatDiagnostic } from "./gigaChatDiagnostics";

const AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const API_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1";

let accessToken: { value: string; expiresAt: number } | null = null;

const GIGACHAT_STREAM_IDLE_TIMEOUT_MS = 45_000;

function createStreamWatchdog(signal: AbortSignal): {
  signal: AbortSignal;
  start: () => void;
  touch: () => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waitingForFirstToken = true;
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forwardAbort, { once: true });

  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    const phase = waitingForFirstToken ? "первого токена" : "следующего токена";
    timer = setTimeout(() => {
      controller.abort(
        new TimeoutError(
          `GigaChat: ожидание ${phase} превысило ${GIGACHAT_STREAM_IDLE_TIMEOUT_MS / 1000} с`,
        ),
      );
    }, GIGACHAT_STREAM_IDLE_TIMEOUT_MS);
  };

  return {
    signal: controller.signal,
    start: arm,
    touch() {
      waitingForFirstToken = false;
      arm();
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", forwardAbort);
    },
  };
}

function normalizeGigaChatAuthKey(raw: string): string {
  let key = raw.trim();
  if (key.toLowerCase().startsWith("basic ")) {
    key = key.slice(6).trim();
  }
  return key;
}

type ChatResponse = {
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  error?: { message?: unknown };
  message?: unknown;
};

async function getAccessToken(
  settings: AppSettings,
  signal?: AbortSignal,
): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) {
    return accessToken.value;
  }
  const rawKey = await loadGigaChatAuthKey();
  if (!rawKey) {
    setGigaChatAuthKeyPresent(false);
    throw new Error("Ключ авторизации GigaChat не сохранён в настройках.");
  }
  setGigaChatAuthKeyPresent(true);
  const authKey = normalizeGigaChatAuthKey(rawKey);
  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authKey}`,
      RqUID: crypto.randomUUID(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `scope=${encodeURIComponent(settings.gigaChatScope)}`,
    signal,
  });
  const raw = await response.text();
  if (!response.ok) throw apiError("GigaChat OAuth", response.status, raw);
  const body = JSON.parse(raw) as {
    access_token?: unknown;
    expires_at?: unknown;
  };
  if (typeof body.access_token !== "string") {
    throw new Error("GigaChat не вернул access token.");
  }
  const rawExpiry =
    typeof body.expires_at === "number" ? body.expires_at : Date.now() + 25 * 60_000;
  const expiresAt = rawExpiry < 10_000_000_000 ? rawExpiry * 1000 : rawExpiry;
  accessToken = { value: body.access_token, expiresAt };
  return accessToken.value;
}

async function apiHeaders(
  settings: AppSettings,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getAccessToken(settings, signal)}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function apiError(service: string, status: number, raw: string): Error {
  try {
    const body = JSON.parse(raw) as ChatResponse;
    const detail =
      typeof body.error?.message === "string"
        ? body.error.message
        : typeof body.message === "string"
          ? body.message
          : "";
    return new Error(`${service} вернул HTTP ${status}.${detail ? ` ${detail}` : ""}`);
  } catch {
    return new Error(`${service} вернул HTTP ${status}. ${raw.slice(0, 300)}`);
  }
}

function extractJson(text: string): string {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
}

function gigaMessages(messages: ChatMessage[]) {
  return messages.map(({ role, content }) => ({
    role,
    content: content.replace(/\n*\/no_think\s*$/i, ""),
  }));
}

export async function completeGigaChatJson<T>(
  messages: ChatMessage[],
  settings: AppSettings,
  maxTokens = 256,
  task: ModelTask = "json",
): Promise<T> {
  return enqueueGigaChatRequest(async () => {
    const startedAt = Date.now();
    const model =
      task === "initiativeSynthesis" || task === "initiativeGate"
        ? resolveSynthesisModel(settings)
        : resolveModel(task, settings);
    const messagesForJson = gigaMessages(messages);
    const systemMessage = messagesForJson.find(({ role }) => role === "system");
    if (systemMessage) {
      systemMessage.content +=
        "\nВерни только валидный JSON без markdown, комментариев и текста вне JSON.";
    } else {
      messagesForJson.unshift({
        role: "system",
        content:
          "Верни только валидный JSON без markdown, комментариев и текста вне JSON.",
      });
    }
    const response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: await apiHeaders(settings),
      body: JSON.stringify({
        model,
        messages: messagesForJson,
        temperature: 0.1,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      recordGigaChatThrottle(response.status);
      recordGigaChatDiagnostic({
        at: Date.now(),
        kind: "json",
        model,
        outcome: "http_error",
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      throw apiError("GigaChat", response.status, raw);
    }
    try {
      const body = JSON.parse(raw) as ChatResponse;
      const choice = body.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        const finishReason =
          typeof choice?.finish_reason === "string"
            ? choice.finish_reason
            : undefined;
        recordGigaChatDiagnostic({
          at: Date.now(),
          kind: "json",
          model,
          outcome: "empty",
          finishReason,
          durationMs: Date.now() - startedAt,
        });
        throw new Error(
          `GigaChat вернул пустой структурированный ответ (finish_reason=${finishReason ?? "unknown"}).`,
        );
      }
      const parsed = JSON.parse(extractJson(text)) as T;
      recordGigaChatSuccess();
      recordGigaChatDiagnostic({
        at: Date.now(),
        kind: "json",
        model,
        outcome: "success",
        finishReason:
          typeof choice?.finish_reason === "string"
            ? choice.finish_reason
            : undefined,
        durationMs: Date.now() - startedAt,
      });
      return parsed;
    } catch (error) {
      // JSON/schema/model-tier failures are request-specific. The independent
      // /models health poll owns provider availability; otherwise a Pro-only
      // HTTP 402 incorrectly marks a working Lite provider offline.
      throw error;
    }
  }, undefined, { kind: "json", priority: "background" });
}

export async function streamGigaChat(
  messages: ChatMessage[],
  settings: AppSettings,
  onUpdate: (content: string) => void,
  onEmotion: (emotion: CharacterEmotion) => void,
  signal: AbortSignal,
): Promise<string> {
  return enqueueGigaChatRequest(async () => {
    const startedAt = Date.now();
    const decoder = new TextDecoder();
    let rawBody = "";
    let visibleContent = "";
    let detectedEmotion: CharacterEmotion | null = null;
    const watchdog = createStreamWatchdog(signal);
    const parser = createGigaChatStreamParser({
      onContent(content) {
        watchdog.touch();
        const emotion = parseEmotionFromContent(content);
        if (emotion && emotion !== detectedEmotion) {
          detectedEmotion = emotion;
          onEmotion(emotion);
        }
        const cleaned = stripEmotionMarkup(content);
        if (cleaned !== visibleContent) {
          visibleContent = cleaned;
          onUpdate(visibleContent);
        }
      },
    });

    let status: number;
    try {
      watchdog.start();
      const headers = await apiHeaders(settings, watchdog.signal);
      status = await gigaChatStream(
        `${API_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: settings.gigaChatModel,
            messages: gigaMessages(messages),
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
            stream: true,
          }),
          signal: watchdog.signal,
        },
        (chunk) => {
          if (watchdog.signal.aborted) return;
          const decoded = decoder.decode(chunk, { stream: true });
          rawBody = `${rawBody}${decoded}`.slice(-16_000);
          parser.push(decoded);
        },
      );
    } catch (error) {
      const snapshot = parser.snapshot();
      const isTimeout = error instanceof TimeoutError;
      const isAborted = !isTimeout && signal.aborted;
      if (!isAborted) recordGigaChatFailure();
      recordGigaChatDiagnostic({
        at: Date.now(),
        kind: "chat",
        model: settings.gigaChatModel,
        outcome: isTimeout ? "timeout" : isAborted ? "aborted" : "transport_error",
        durationMs: Date.now() - startedAt,
        finishReason: snapshot.finishReason ?? undefined,
        eventCount: snapshot.eventCount,
        contentChunks: snapshot.contentChunks,
        malformedEvents: snapshot.malformedEvents,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      watchdog.dispose();
    }
    const tail = decoder.decode();
    rawBody = `${rawBody}${tail}`.slice(-16_000);
    parser.push(tail);
    const summary = parser.finish();

    if (status < 200 || status >= 300) {
      recordGigaChatThrottle(status);
      recordGigaChatFailure();
      recordGigaChatDiagnostic({
        at: Date.now(),
        kind: "chat",
        model: settings.gigaChatModel,
        outcome: "http_error",
        status,
        finishReason: summary.finishReason ?? undefined,
        durationMs: Date.now() - startedAt,
        eventCount: summary.eventCount,
        contentChunks: summary.contentChunks,
        malformedEvents: summary.malformedEvents,
      });
      throw apiError("GigaChat", status, rawBody);
    }
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Запрос GigaChat отменён.", "AbortError");
    }
    const finalContent = stripEmotionMarkup(summary.content).trim();
    if (!finalContent) {
      recordGigaChatFailure();
      const detail = describeEmptyGigaChatStream(summary);
      recordGigaChatDiagnostic({
        at: Date.now(),
        kind: "chat",
        model: settings.gigaChatModel,
        outcome: "empty",
        finishReason: summary.finishReason ?? undefined,
        durationMs: Date.now() - startedAt,
        eventCount: summary.eventCount,
        contentChunks: summary.contentChunks,
        malformedEvents: summary.malformedEvents,
        detail,
      });
      throw new Error(detail);
    }
    recordGigaChatSuccess();
    recordGigaChatDiagnostic({
      at: Date.now(),
      kind: "chat",
      model: settings.gigaChatModel,
      outcome: "success",
      finishReason: summary.finishReason ?? undefined,
      durationMs: Date.now() - startedAt,
      eventCount: summary.eventCount,
      contentChunks: summary.contentChunks,
      malformedEvents: summary.malformedEvents,
    });
    return finalContent;
  }, signal, { kind: "chat", priority: "interactive" });
}

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(sanitizeBase64ImagePayload(base64));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function uploadCapture(
  capture: ScreenCapture,
  settings: AppSettings,
  index: number,
): Promise<string> {
  const token = await getAccessToken(settings);
  const form = new FormData();
  form.append(
    "file",
    new Blob([base64Bytes(capture.imageBase64)], { type: "image/png" }),
    `ari-capture-${index + 1}.png`,
  );
  form.append("purpose", "general");
  const response = await fetch(`${API_BASE_URL}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: form,
  });
  const raw = await response.text();
  if (!response.ok) throw apiError("GigaChat files", response.status, raw);
  const body = JSON.parse(raw) as { id?: unknown };
  if (typeof body.id !== "string") {
    throw new Error("GigaChat не вернул идентификатор изображения.");
  }
  capture.imageBase64 = "";
  return body.id;
}

async function deleteFile(id: string, settings: AppSettings): Promise<void> {
  await fetch(`${API_BASE_URL}/files/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await apiHeaders(settings),
  }).catch(() => undefined);
}

export async function analyzeGigaChatImages(
  captures: ScreenCapture[],
  prompt: string,
  settings: AppSettings,
): Promise<string> {
  return enqueueGigaChatRequest(async () => {
  const fileIds: string[] = [];
  try {
    for (let index = 0; index < captures.length; index += 1) {
      fileIds.push(await uploadCapture(captures[index], settings, index));
    }
    const messages = captures.map((_, index) => ({
      role: "user",
      content:
        index === captures.length - 1
          ? prompt
          : `Изображение ${index + 1} для последующего сравнения.`,
      attachments: [fileIds[index]],
    }));
    const response = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: await apiHeaders(settings),
      body: JSON.stringify({
        model: resolveModel("vision", settings),
        messages,
        temperature: 0.1,
        max_tokens: Math.min(settings.maxTokens, 1600),
        stream: false,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      recordGigaChatThrottle(response.status);
      throw apiError("GigaChat vision", response.status, raw);
    }
    const body = JSON.parse(raw) as ChatResponse;
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("GigaChat vision вернул пустой ответ.");
    }
    return text.trim();
  } finally {
    await Promise.all(fileIds.map((id) => deleteFile(id, settings)));
  }
  }, undefined, { kind: "vision", priority: "background" });
}

export async function createGigaChatEmbeddings(
  input: string[],
  settings: AppSettings,
): Promise<number[][]> {
  return enqueueGigaChatRequest(async () => {
  const response = await fetch(`${API_BASE_URL}/embeddings`, {
    method: "POST",
    headers: await apiHeaders(settings),
    body: JSON.stringify({
      model: settings.gigaChatEmbeddingModel,
      input,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    recordGigaChatThrottle(response.status);
    throw apiError("GigaChat embeddings", response.status, raw);
  }
  const body = JSON.parse(raw) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  return (body.data ?? [])
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map(({ embedding }) => embedding ?? []);
  }, undefined, { kind: "embedding", priority: "background" });
}

export async function checkGigaChatStatus(
  settings: AppSettings,
): Promise<{ online: boolean; error?: string }> {
  return enqueueGigaChatRequest(async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/models`, {
      headers: await apiHeaders(settings),
    });
    if (!response.ok) {
      recordGigaChatThrottle(response.status);
      recordGigaChatFailure();
      throw apiError("GigaChat", response.status, await response.text());
    }
    recordGigaChatSuccess();
    return { online: true };
  } catch (error) {
    recordGigaChatFailure();
    return {
      online: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  }, undefined, { kind: "status", priority: "background" });
}

export function clearGigaChatTokenCache(): void {
  accessToken = null;
}
