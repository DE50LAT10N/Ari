import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import { completeLlmJson } from "../llm/llmClient";
import { sanitizeUntrusted, wrapUntrusted } from "../character/promptSafety";
import { httpFetch } from "../platform/webTools";

export type LiveToolKind = "web_search" | "web_fetch" | "datetime";

export type LiveToolPlan = {
  tool: LiveToolKind;
  query?: string;
  url?: string;
};

type LiveToolPlanResponse = {
  tool?: LiveToolKind | null;
  query?: string;
  url?: string;
};

const LIVE_TOOL_KEYWORDS =
  /(?:который час|сколько времени|сейчас час|какое время|какая дата|какой день|сегодня число|что сейчас|погод|найди|поиск|загугли|погугли|в интернете|актуальн|новост|курс|цена|когда вышел|что такое|кто такой|https?:\/\/|www\.)/i;

export function shouldConsiderLiveTools(userMessage: string): boolean {
  return LIVE_TOOL_KEYWORDS.test(userMessage.trim());
}

export function getDateTime(): string {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    `Дата и время: ${now.toLocaleString("ru-RU", {
      dateStyle: "full",
      timeStyle: "medium",
    })}`,
    `День недели: ${now.toLocaleDateString("ru-RU", { weekday: "long" })}`,
    `Часовой пояс: ${timeZone}`,
    `Unix timestamp: ${Math.floor(now.getTime() / 1000)}`,
  ].join("\n");
}

export function stripHtmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, " ");
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export function parseDuckDuckGoResults(html: string, limit = 5): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null && results.length < limit) {
    const url = decodeDuckDuckGoUrl(match[1]);
    const title = stripHtmlToText(match[2]).slice(0, 200);
    if (!url || !title) continue;
    const after = html.slice(match.index, match.index + 1200);
    const snippetMatch = after.match(
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i,
    );
    const snippet = snippetMatch
      ? stripHtmlToText(snippetMatch[1]).slice(0, 320)
      : "";
    results.push({ title, url, snippet });
  }
  return results;
}

function decodeDuckDuckGoUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export async function webSearch(
  query: string,
  _settings: AppSettings,
): Promise<string> {
  const encoded = encodeURIComponent(query.trim().slice(0, 200));
  const response = await httpFetch(
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `q=${encoded}`,
    },
  );

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Поиск вернул статус ${response.status}`);
  }

  const results = parseDuckDuckGoResults(response.body, 5);
  if (!results.length) {
    return `По запросу «${query}» ничего не найдено.`;
  }

  return results
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.title}\n   ${entry.url}${
          entry.snippet ? `\n   ${entry.snippet}` : ""
        }`,
    )
    .join("\n\n");
}

export async function webFetch(url: string): Promise<string> {
  const normalized = url.trim();
  const response = await httpFetch(normalized);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Страница вернула статус ${response.status}`);
  }
  const text = stripHtmlToText(response.body).slice(0, 4000);
  if (!text) {
    return "Страница загружена, но текст не удалось извлечь.";
  }
  return text;
}

export async function planLiveToolUse(
  userMessage: string,
  settings: AppSettings,
): Promise<LiveToolPlan | null> {
  if (!settings.webToolsEnabled || !shouldConsiderLiveTools(userMessage)) {
    return null;
  }

  const response = await completeLlmJson<LiveToolPlanResponse>(
    [
      {
        role: "system",
        content: [
          "Определи, нужен ли внешний read-only инструмент для ответа на сообщение пользователя.",
          "Допустимые инструменты:",
          "- datetime: точная локальная дата/время/день недели",
          "- web_search: актуальная информация из интернета (новости, цены, факты)",
          "- web_fetch: прочитать конкретную веб-страницу по URL",
          'Верни {"tool":null}, если инструмент не нужен.',
          'Иначе {"tool":"web_search|web_fetch|datetime","query":"...","url":"..."}',
          "Не выбирай инструмент для обычного разговора, эмоций или вопросов, на которые можно ответить без сети.",
        ].join("\n"),
      },
      {
        role: "user",
        content: userMessage.slice(0, 1200),
      },
    ] satisfies ChatMessage[],
    settings,
    180,
    "validator",
  );

  if (
    response.tool !== "web_search" &&
    response.tool !== "web_fetch" &&
    response.tool !== "datetime"
  ) {
    return null;
  }

  if (response.tool === "web_fetch") {
    const url = response.url?.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return null;
    }
    return { tool: "web_fetch", url };
  }

  if (response.tool === "web_search") {
    const query = response.query?.trim() || userMessage.trim().slice(0, 200);
    if (!query) return null;
    return { tool: "web_search", query };
  }

  return { tool: "datetime" };
}

export async function runLiveTool(
  plan: LiveToolPlan,
  settings: AppSettings,
): Promise<string> {
  if (plan.tool === "datetime") {
    return getDateTime();
  }
  if (plan.tool === "web_search" && plan.query) {
    return webSearch(plan.query, settings);
  }
  if (plan.tool === "web_fetch" && plan.url) {
    return webFetch(plan.url);
  }
  throw new Error("Некорректный план инструмента.");
}

export function formatLiveToolContext(
  plan: LiveToolPlan,
  rawResult: string,
): string {
  const label =
    plan.tool === "datetime"
      ? "Точная дата и время"
      : plan.tool === "web_search"
        ? `Результаты поиска${plan.query ? `: ${plan.query}` : ""}`
        : `Содержимое страницы${plan.url ? `: ${plan.url}` : ""}`;

  const sanitized = sanitizeUntrusted(rawResult, 4500);
  return wrapUntrusted(
    [label, sanitized].filter(Boolean).join("\n"),
    "live-tool",
  );
}
