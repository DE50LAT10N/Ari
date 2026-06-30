import { gigaChatFetch as fetch } from "../platform/gigaChatHttp";
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

const AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const API_BASE_URL = "https://gigachat.devices.sberbank.ru/api/v1";

let accessToken: { value: string; expiresAt: number } | null = null;

function normalizeGigaChatAuthKey(raw: string): string {
  let key = raw.trim();
  if (key.toLowerCase().startsWith("basic ")) {
    key = key.slice(6).trim();
  }
  return key;
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
  message?: unknown;
};

async function getAccessToken(settings: AppSettings): Promise<string> {
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
): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getAccessToken(settings)}`,
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
  const model =
    task === "initiativeSynthesis" || task === "initiativeGate"
      ? resolveSynthesisModel(settings)
      : resolveModel(task, settings);
  const messagesForJson = gigaMessages(messages);
  const systemMessage = messagesForJson.find(
    ({ role }) => role === "system",
  );
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
    recordGigaChatFailure();
    throw apiError("GigaChat", response.status, raw);
  }
  try {
    const body = JSON.parse(raw) as ChatResponse;
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      recordGigaChatFailure();
      throw new Error("GigaChat вернул пустой структурированный ответ.");
    }
    recordGigaChatSuccess();
    return JSON.parse(extractJson(text)) as T;
  } catch (error) {
    recordGigaChatFailure();
    throw error;
  }
}

export async function streamGigaChat(
  messages: ChatMessage[],
  settings: AppSettings,
  onUpdate: (content: string) => void,
  onEmotion: (emotion: CharacterEmotion) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: await apiHeaders(settings),
    body: JSON.stringify({
      model: settings.gigaChatModel,
      messages: gigaMessages(messages),
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: true,
    }),
    signal,
  });
  if (!response.ok) {
    recordGigaChatFailure();
    throw apiError("GigaChat", response.status, await response.text());
  }
  if (!response.body) throw new Error("GigaChat не предоставил поток ответа.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawContent = "";
  let visibleContent = "";
  let detectedEmotion: CharacterEmotion | null = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      let event: { choices?: Array<{ delta?: { content?: unknown } }> };
      try {
        event = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown } }>;
        };
      } catch {
        continue;
      }
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta !== "string") continue;
      rawContent += delta;
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
    if (done) break;
  }
  const finalContent = stripEmotionMarkup(rawContent).trim();
  if (!finalContent) {
    recordGigaChatFailure();
    throw new Error("GigaChat вернул пустой ответ.");
  }
  recordGigaChatSuccess();
  return finalContent;
}

function sanitizeBase64Image(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    return comma >= 0 ? trimmed.slice(comma + 1).replace(/\s+/g, "") : trimmed;
  }
  return trimmed.replace(/\s+/g, "");
}

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(sanitizeBase64Image(base64));
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
    if (!response.ok) throw apiError("GigaChat vision", response.status, raw);
    const body = JSON.parse(raw) as ChatResponse;
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("GigaChat vision вернул пустой ответ.");
    }
    return text.trim();
  } finally {
    await Promise.all(fileIds.map((id) => deleteFile(id, settings)));
  }
}

export async function createGigaChatEmbeddings(
  input: string[],
  settings: AppSettings,
): Promise<number[][]> {
  const response = await fetch(`${API_BASE_URL}/embeddings`, {
    method: "POST",
    headers: await apiHeaders(settings),
    body: JSON.stringify({
      model: settings.gigaChatEmbeddingModel,
      input,
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw apiError("GigaChat embeddings", response.status, raw);
  const body = JSON.parse(raw) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  return (body.data ?? [])
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map(({ embedding }) => embedding ?? []);
}

export async function checkGigaChatStatus(
  settings: AppSettings,
): Promise<{ online: boolean; error?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/models`, {
      headers: await apiHeaders(settings),
    });
    if (!response.ok) {
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
}

export function clearGigaChatTokenCache(): void {
  accessToken = null;
}
