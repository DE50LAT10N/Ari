import type { AppSettings } from "../settings/appSettings";

export type GigaChatModelTier = "lite" | "pro" | "max";

export type GigaChatModelOption = {
  id: string;
  label: string;
  tier: GigaChatModelTier;
  hint: string;
  legacy?: boolean;
};

/** IDs accepted by GigaChat API (gen 2 + legacy aliases). */
export const GIGA_CHAT_CHAT_MODELS: GigaChatModelOption[] = [
  {
    id: "GigaChat-2-Max",
    label: "GigaChat 2 Max",
    tier: "max",
    hint: "Максимум качества — проактивка, сложные ответы, длинный контекст",
  },
  {
    id: "GigaChat-2-Pro",
    label: "GigaChat 2 Pro",
    tier: "pro",
    hint: "Баланс цены и качества — рекомендуется для Ari",
  },
  {
    id: "GigaChat-2",
    label: "GigaChat 2 Lite",
    tier: "lite",
    hint: "Быстро и дёшево; слабее для JSON-инициативы",
  },
  {
    id: "GigaChat-Max",
    label: "GigaChat Max (legacy → 2-Max)",
    tier: "max",
    hint: "Старый ID, API перенаправит на GigaChat-2-Max",
    legacy: true,
  },
  {
    id: "GigaChat-Pro",
    label: "GigaChat Pro (legacy → 2-Pro)",
    tier: "pro",
    hint: "Старый ID, API перенаправит на GigaChat-2-Pro",
    legacy: true,
  },
  {
    id: "GigaChat",
    label: "GigaChat Lite (legacy → 2)",
    tier: "lite",
    hint: "Старый ID, API перенаправит на GigaChat-2",
    legacy: true,
  },
];

export const GIGA_CHAT_VISION_MODELS: GigaChatModelOption[] = [
  {
    id: "GigaChat-2-Max",
    label: "GigaChat 2 Max",
    tier: "max",
    hint: "Лучшее описание экрана",
  },
  {
    id: "GigaChat-2-Pro",
    label: "GigaChat 2 Pro",
    tier: "pro",
    hint: "Баланс для vision",
  },
  {
    id: "GigaChat-2",
    label: "GigaChat 2 Lite",
    tier: "lite",
    hint: "Быстрее, проще",
  },
  {
    id: "GigaChat",
    label: "GigaChat (legacy)",
    tier: "lite",
    hint: "Старый ID",
    legacy: true,
  },
];

export const GIGA_CHAT_EMBEDDING_MODELS = [
  {
    id: "EmbeddingsGigaR",
    label: "EmbeddingsGigaR",
    hint: "Рекомендуется для RAG",
  },
  {
    id: "Embeddings",
    label: "Embeddings (legacy)",
    hint: "Старый ID embeddings",
  },
] as const;

const CHAT_MODEL_BY_ID = new Map(
  GIGA_CHAT_CHAT_MODELS.map((option) => [option.id, option]),
);

export function findGigaChatChatModel(id: string): GigaChatModelOption | undefined {
  return CHAT_MODEL_BY_ID.get(id);
}

export function isLiteGigaChatModelId(model: string): boolean {
  const known = findGigaChatChatModel(model);
  if (known) {
    return known.tier === "lite";
  }
  return /lite|^gigachat-?2?$/i.test(model) && !/pro|max/i.test(model);
}

/**
 * Pick auxiliary model (JSON / vision / memory) without downgrading below chat tier.
 * If chat is Pro/Max but auxiliary is Lite, use chat model instead.
 */
export function resolveGigaChatAuxModel(
  chatModel: string,
  auxiliary?: string,
): string {
  const chat = chatModel.trim();
  const candidate = (auxiliary?.trim() || chat).trim();
  if (!chat || !candidate) {
    return candidate || chat;
  }
  if (isLiteGigaChatModelId(candidate) && !isLiteGigaChatModelId(chat)) {
    return chat;
  }
  return candidate;
}

export function syncGigaChatModelSelection(
  settings: AppSettings,
  gigaChatModel: string,
): AppSettings {
  const next: AppSettings = { ...settings, gigaChatModel };
  if (!isLiteGigaChatModelId(gigaChatModel)) {
    if (settings.fastJsonModel && isLiteGigaChatModelId(settings.fastJsonModel)) {
      next.fastJsonModel = undefined;
    }
    if (isLiteGigaChatModelId(settings.gigaChatVisionModel)) {
      next.gigaChatVisionModel = gigaChatModel;
    }
    if (settings.memoryModel && isLiteGigaChatModelId(settings.memoryModel)) {
      next.memoryModel = undefined;
    }
  }
  return next;
}

export function migrateGigaChatModelSettings(settings: AppSettings): AppSettings {
  if (settings.llmProvider !== "gigachat") {
    return settings;
  }
  return syncGigaChatModelSelection(settings, settings.gigaChatModel);
}

export function describeGigaChatChatModel(id: string): string {
  const known = findGigaChatChatModel(id);
  return known ? `${known.label} (${known.id})` : id;
}
