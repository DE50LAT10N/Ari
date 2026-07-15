import type { AppSettings } from "../settings/appSettings";
import type { ChatMessage } from "../types/chat";
import { completeLlmJson } from "../llm/llmClient";
import { sanitizeUntrusted, wrapUntrusted } from "../character/promptSafety";
import { withTimeout } from "../platform/asyncTimeout";
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
  /(?:который час|сколько времени|сейчас час|какое время|какая дата|какой день|сегодня число|что сейчас|погод|найди|поиск|загугли|погугли|в интернете|актуальн|новост|курс|цена|когда вышел|что такое|кто такой|подскажи|объясни|расскажи|что значит|как сделать|как работает|почему|зачем|https?:\/\/|www\.)/i;

/** Date/time, URL, weather, live rates — needs LLM tool picker. */
const EXPLICIT_LIVE_TOOL_PLANNER =
  /(?:который час|сколько времени|сейчас час|какое время|какая дата|какой день|сегодня число|погод|курс|цена|https?:\/\/|www\.)/i;

export function shouldConsiderLiveTools(userMessage: string): boolean {
  return LIVE_TOOL_KEYWORDS.test(userMessage.trim());
}

export function needsExplicitLiveToolPlanner(userMessage: string): boolean {
  return EXPLICIT_LIVE_TOOL_PLANNER.test(userMessage.trim());
}

export function isQuestionLikeMessage(userMessage: string): boolean {
  const normalized = userMessage.trim();
  if (!normalized) {
    return false;
  }
  if (/(?:курс|цена|погод|сколько стоит|актуальн|новост)/i.test(normalized)) {
    return true;
  }
  if (
    /(?:подскажи|объясни|расскажи|что такое|как сделать|как работает|почему|зачем|когда|где|кто такой|можешь ли|что значит|какой|какая)/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return /\?/.test(normalized) && normalized.length >= 12;
}

const EXTERNAL_WEB_HINT =
  /(?:в интернете|актуальн|сейчас в|новост|курс|цена|когда вышел|найди|загугли|погугли|погод)/i;

export function shouldAutoWebSearch(
  userMessage: string,
  options: {
    ragEnabled: boolean;
    ragMatchCount: number;
  },
): boolean {
  const normalized = userMessage.trim();
  if (normalized.length < 4) {
    return false;
  }
  // RAG runs first; web search is a fallback when documents returned nothing.
  if (options.ragEnabled) {
    if (!isQuestionLikeMessage(userMessage)) {
      return false;
    }
    return options.ragMatchCount === 0;
  }
  // RAG off: only fetch the web for clearly external / live data questions.
  return EXTERNAL_WEB_HINT.test(normalized);
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

export function parseDuckDuckGoLiteResults(
  html: string,
  limit = 5,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const tagPattern = /<a\b[^>]*class=['"]result-link['"][^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  while (
    (tagMatch = tagPattern.exec(html)) !== null &&
    results.length < limit
  ) {
    const tag = tagMatch[0];
    const hrefMatch = tag.match(/href=['"]([^'"]+)['"]/i);
    const url = hrefMatch ? decodeDuckDuckGoUrl(hrefMatch[1]) : "";
    const start = tagMatch.index + tag.length;
    const endMatch = html.slice(start).match(/^([\s\S]*?)<\/a>/i);
    const title = endMatch ? stripHtmlToText(endMatch[1]).slice(0, 200) : "";
    if (!url || !title) {
      continue;
    }
    const after = html.slice(tagMatch.index, tagMatch.index + 1600);
    const snippetMatch = after.match(
      /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\//i,
    );
    const snippet = snippetMatch
      ? stripHtmlToText(snippetMatch[1]).slice(0, 320)
      : "";
    results.push({ title, url, snippet });
  }
  return results;
}

export function parseDuckDuckGoResults(html: string, limit = 5): WebSearchResult[] {
  const liteResults = parseDuckDuckGoLiteResults(html, limit);
  if (liteResults.length > 0) {
    return liteResults;
  }

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
  const trimmed = raw
    .trim()
    .replace(/&amp;/g, "&");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        return decodeURIComponent(uddg);
      }
      return parsed.toString();
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("//")) {
    return decodeDuckDuckGoUrl(`https:${trimmed}`);
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

const WEB_SEARCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
};

async function fetchDuckDuckGoSearchHtml(query: string): Promise<string> {
  const encoded = encodeURIComponent(query.trim().slice(0, 200));

  const liteResponse = await httpFetch(
    `https://lite.duckduckgo.com/lite/?q=${encoded}`,
    {
      method: "GET",
      headers: WEB_SEARCH_HEADERS,
    },
  );
  if (liteResponse.status >= 200 && liteResponse.status < 300) {
    if (parseDuckDuckGoLiteResults(liteResponse.body, 1).length > 0) {
      return liteResponse.body;
    }
  }

  const htmlResponse = await httpFetch(
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    {
      method: "POST",
      headers: {
        ...WEB_SEARCH_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `q=${encoded}`,
    },
  );
  if (htmlResponse.status < 200 || htmlResponse.status >= 300) {
    throw new Error(`Поиск вернул статус ${htmlResponse.status}`);
  }
  return htmlResponse.body;
}

export async function webSearch(
  query: string,
  _settings: AppSettings,
): Promise<string> {
  const html = await withTimeout(
    fetchDuckDuckGoSearchHtml(query),
    25_000,
    "Веб-поиск",
  );

  const results = parseDuckDuckGoResults(html, 5);
  if (!results.length) {
    throw new Error(
      `По запросу «${query}» не удалось получить результаты поиска.`,
    );
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
  if (!settings.webToolsEnabled || !needsExplicitLiveToolPlanner(userMessage)) {
    return null;
  }

  const response = await withTimeout(
    completeLlmJson<LiveToolPlanResponse>(
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
    ),
    20_000,
    "Выбор live-инструмента",
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
