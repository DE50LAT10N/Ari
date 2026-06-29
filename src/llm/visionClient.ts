import { fetch } from "@tauri-apps/plugin-http";
import type { ScreenCapture } from "../platform/screenCapture";
import type { AppSettings } from "../settings/appSettings";
import { analyzeGigaChatImages } from "./gigaChatClient";
import { loadOllamaModel, unloadOllamaModel } from "./localLlmClient";
import { resolveModel } from "./modelRouter";
import { getVisionSource } from "./visionConfig";
import { logError } from "../platform/logger";

type VisionResponse = {
  message?: { content?: unknown };
  error?: unknown;
};

function sanitizeBase64Image(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    return comma >= 0 ? trimmed.slice(comma + 1).replace(/\s+/g, "") : trimmed;
  }
  return trimmed.replace(/\s+/g, "");
}

function validateCapture(capture: ScreenCapture): string {
  const image = sanitizeBase64Image(capture.imageBase64);
  if (!image || image.length < 256) {
    throw new Error(
      "Снимок пустой или повреждён. Убедитесь, что активное окно видно на экране.",
    );
  }
  return image;
}

async function ensureOllamaVisionModel(settings: AppSettings): Promise<string> {
  const model = resolveModel("vision", settings);
  try {
    if (settings.llmProvider === "ollama" && settings.model !== model) {
      await unloadOllamaModel(settings.ollamaBaseUrl, settings.model).catch(
        () => undefined,
      );
    }
    await loadOllamaModel(
      settings.ollamaBaseUrl,
      model,
      Math.max(8192, settings.contextTokens),
    );
  } catch (error) {
    logError("Failed to preload vision model", error);
  }
  return model;
}

async function requestOllamaVision(
  settings: AppSettings,
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
    images?: string[];
  }>,
): Promise<string> {
  const model = await ensureOllamaVisionModel(settings);
  const response = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages,
      options: {
        temperature: 0.2,
        num_predict: Math.min(settings.maxTokens, 1200),
        num_ctx: Math.max(8192, settings.contextTokens),
      },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as VisionResponse;

  if (!response.ok) {
    const detail = typeof body.error === "string" ? ` ${body.error}` : "";
    throw new Error(
      `Vision-модель «${model}» вернула HTTP ${response.status}.${detail} Проверьте, что модель установлена: ollama pull ${model}`,
    );
  }

  if (typeof body.message?.content !== "string" || !body.message.content.trim()) {
    throw new Error(
      `Vision-модель «${model}» вернула пустой ответ. Возможно, в памяти загружена текстовая модель — выгрузите её в настройках.`,
    );
  }

  const text = body.message.content.trim();
  if (
    /не вижу|нет изображ|no image|cannot see|can't see|без изображ/i.test(
      text,
    ) &&
    text.length < 200
  ) {
    throw new Error(
      `Модель «${model}» не обработала снимок. Установите vision-модель: ollama pull ${settings.visionModel}`,
    );
  }

  return text;
}

export async function analyzeScreenCapture(
  capture: ScreenCapture,
  prompt: string,
  settings: AppSettings,
): Promise<string> {
  const imageBase64 = validateCapture(capture);
  capture.imageBase64 = "";

  if (getVisionSource(settings) === "gigachat") {
    capture.imageBase64 = imageBase64;
    return analyzeGigaChatImages(
      [capture],
      [
        "Проанализируй приложенное изображение активного окна.",
        `Приложение: ${capture.processName}. Заголовок: ${capture.title}.`,
        prompt,
        "Верни на русском точные наблюдения по содержимому изображения. Не выдумывай невидимое.",
      ].join("\n"),
      settings,
    );
  }

  return requestOllamaVision(settings, [
    {
      role: "system",
      content: [
        "Ты модуль компьютерного зрения. Анализируй только прикреплённое изображение.",
        "Верни на русском точные наблюдения: что видно, важный текст, ошибки.",
        "Не переписывай пароли, токены и номера карт — помечай как [скрыто].",
        "Не используй приветствия и обращения к пользователю.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Приложение: ${capture.processName}. Заголовок: ${capture.title}.`,
        prompt,
        "Опиши только то, что реально видно на прикреплённом изображении.",
      ].join("\n"),
      images: [imageBase64],
    },
  ]);
}

export async function compareScreenCaptures(
  before: ScreenCapture,
  after: ScreenCapture,
  prompt: string,
  settings: AppSettings,
): Promise<string> {
  const beforeImage = validateCapture(before);
  const afterImage = validateCapture(after);
  before.imageBase64 = "";
  after.imageBase64 = "";

  if (getVisionSource(settings) === "gigachat") {
    before.imageBase64 = beforeImage;
    after.imageBase64 = afterImage;
    return analyzeGigaChatImages([before, after], prompt, settings);
  }

  return requestOllamaVision(settings, [
    {
      role: "system",
      content:
        "Сравни два прикреплённых снимка. Верни на русском только точные различия.",
    },
    {
      role: "user",
      content: "Первый снимок (раньше):",
      images: [beforeImage],
    },
    {
      role: "user",
      content: "Второй снимок (позже):",
      images: [afterImage],
    },
    {
      role: "user",
      content: prompt,
    },
  ]);
}
