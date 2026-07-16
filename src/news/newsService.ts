import { httpFetch } from "../platform/webTools";
import { canonicalizeNewsUrl, extractArticleMetadata, normalizeNewsTitle, parseFeed } from "./newsParser";
import type { NewsDiagnostics, NewsItem, NewsRejectionReason, NewsSource, RankedNewsItem } from "./types";
import type { AppSettings } from "../settings/appSettings";

const CACHE_KEY = "desktop-character.news-cache.v1";
const SHOWN_KEY = "desktop-character.news-shown.v1";
const DIAGNOSTICS_KEY = "desktop-character.news-diagnostics.v1";
export const NEWS_CACHE_TTL_MS = 72 * 60 * 60_000;
export const NEWS_ELIGIBLE_AGE_MS = 48 * 60 * 60_000;
export const NEWS_TOPIC_HISTORY_MS = 14 * 24 * 60 * 60_000;
export const NEWS_REFRESH_INTERVAL_MS = 30 * 60_000;
const MAX_CACHE_ITEMS = 200;
const MAX_ARTICLES_PER_SOURCE = 8;

export const DEFAULT_NEWS_SOURCES: NewsSource[] = [
  { id: "github-changelog", publisher: "GitHub Changelog", feedUrl: "https://github.blog/changelog/feed/", sourceWeight: 1 },
  { id: "nasa-technology", publisher: "NASA Technology", feedUrl: "https://www.nasa.gov/technology/feed/", sourceWeight: 0.95 },
  { id: "jpl-news", publisher: "JPL News", feedUrl: "https://www.jpl.nasa.gov/feeds/news/", sourceWeight: 0.95 },
];

type ShownEntry = { id: string; titleKey: string; topics: string[]; at: number; publisher: string; title: string };
type RefreshOptions = { force?: boolean; now?: number; sources?: NewsSource[]; fetcher?: typeof httpFetch };

const SENSITIVE = /(?:^|[^\p{L}\p{N}])(?:politic|election|government|president|war|militar|attack|cyberattack|ransomware|weapon|crime|murder|police|disaster|earthquake|hurricane|flood|wildfire|death|medicine|medical|disease|healthcare|patient|clinical|drug|finance|financial|stock|market(?!place)|bank|crypto|политик|выбор|правительств|президент|войн|военн|атак|оруж|преступ|убий|полици|катастроф|землетряс|ураган|наводнен|пожар|смерт|медицин|болезн|здоров|лекарств|финанс|акци|рынок|банк|крипт)[\p{L}\p{N}_-]*/iu;
const PROMPT_INJECTION = /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions?|prompts?)|(?:system|developer)\s+(?:message|prompt)|act\s+as\s+(?:an?|the)|игнорируй\s+(?:все\s+)?(?:предыдущие\s+)?инструкции|системн(?:ый|ое)\s+(?:промпт|сообщение)/iu;
let refreshPromise: Promise<NewsItem[]> | null = null;
let consecutiveFailures = 0;

export function isNewsLayerEnabled(
  settings: Pick<AppSettings, "proactiveEnabled" | "webToolsEnabled" | "newsSmalltalkEnabled">,
  quietModeActive = false,
): boolean {
  return settings.proactiveEnabled && settings.webToolsEnabled && settings.newsSmalltalkEnabled && !quietModeActive;
}

function storageRead<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
function storageWrite(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Cache is best-effort. */ }
}
function notify(): void {
  try { window.dispatchEvent(new CustomEvent("ari-news-state-changed")); } catch { /* Tests/non-window runtime. */ }
}
function hash(value: string): string {
  let current = 2166136261;
  for (let index = 0; index < value.length; index += 1) current = Math.imul(current ^ value.charCodeAt(index), 16777619);
  return (current >>> 0).toString(36);
}
function tokens(value: string): Set<string> {
  return new Set(normalizeNewsTitle(value).split(" ").filter((part) => part.length >= 3));
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count / Math.max(1, Math.min(a.size, b.size));
}
function increment(diag: NewsDiagnostics, reason: NewsRejectionReason): void {
  diag.rejectionCounts[reason] = (diag.rejectionCounts[reason] ?? 0) + 1;
}
function titleMatches(feedTitle: string, articleTitle: string): boolean {
  const a = tokens(feedTitle);
  const b = tokens(articleTitle);
  return overlap(a, b) >= 0.35 || [...a].some((token) => b.has(token) && token.length >= 8);
}

export function loadNewsCache(now = Date.now()): NewsItem[] {
  const raw = storageRead<NewsItem[]>(CACHE_KEY, []);
  return Array.isArray(raw)
    ? raw.filter((item) =>
        Boolean(
          item &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.summary === "string" &&
          typeof item.excerpt === "string" &&
          typeof item.publisher === "string" &&
          canonicalizeNewsUrl(item.url) &&
          Number.isFinite(item.publishedAt) &&
          Number.isFinite(item.fetchedAt) &&
          Array.isArray(item.topics) && item.topics.every((topic) => typeof topic === "string") &&
          Number.isFinite(item.sourceWeight) &&
          item.verification === "feed_and_article" &&
          item.provenance === "untrusted_external_data" &&
          now - item.fetchedAt >= 0 &&
          now - item.fetchedAt <= NEWS_CACHE_TTL_MS,
        ),
      )
    : [];
}

function loadShown(now: number): ShownEntry[] {
  const raw = storageRead<ShownEntry[]>(SHOWN_KEY, []);
  return Array.isArray(raw) ? raw.filter((entry) => now - entry.at <= NEWS_TOPIC_HISTORY_MS) : [];
}

export function getNewsDiagnostics(): NewsDiagnostics {
  const stored = storageRead<NewsDiagnostics>(DIAGNOSTICS_KEY, {
    cacheSize: 0, sourceStatuses: [], rejectionCounts: {},
  });
  return {
    ...stored,
    cacheSize: loadNewsCache().length,
    sourceStatuses: stored.sourceStatuses ?? [],
    rejectionCounts: stored.rejectionCounts ?? {},
  };
}

function saveDiagnostics(value: NewsDiagnostics): void { storageWrite(DIAGNOSTICS_KEY, value); notify(); }

function dedupe(items: NewsItem[], diag?: NewsDiagnostics): NewsItem[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  const sorted = [...items].sort((a, b) => b.publishedAt - a.publishedAt);
  return sorted.filter((item) => {
    const url = canonicalizeNewsUrl(item.url);
    const title = normalizeNewsTitle(item.title);
    if (!url || urls.has(url) || titles.has(title)) { if (diag) increment(diag, "duplicate"); return false; }
    urls.add(url); titles.add(title); return true;
  });
}

async function refreshInternal(options: RefreshOptions): Promise<NewsItem[]> {
  const now = options.now ?? Date.now();
  const sources = options.sources ?? DEFAULT_NEWS_SOURCES;
  const fetcher = options.fetcher ?? httpFetch;
  const prior = getNewsDiagnostics();
  const priorStatuses = new Map(prior.sourceStatuses.map((status) => [status.sourceId, status]));
  const diagnostics: NewsDiagnostics = {
    ...prior,
    lastRefreshAttemptAt: now,
    rejectionCounts: {},
    sourceStatuses: sources.map((source) => ({
      sourceId: source.id,
      publisher: source.publisher,
      status: "loading",
      lastAttemptAt: now,
      lastSuccessAt: priorStatuses.get(source.id)?.lastSuccessAt,
      itemCount: 0,
    })),
  };
  saveDiagnostics(diagnostics);
  const collected: NewsItem[] = [];

  await Promise.all(sources.map(async (source, sourceIndex) => {
    const status = diagnostics.sourceStatuses[sourceIndex];
    try {
      const feedResponse = await fetcher(source.feedUrl, { headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "AriDesktopCharacter/1.2 (+news-smalltalk)",
      } });
      if (feedResponse.status < 200 || feedResponse.status >= 300) throw new Error(`HTTP ${feedResponse.status}`);
      const entries = parseFeed(feedResponse.body, source.feedUrl).slice(0, MAX_ARTICLES_PER_SOURCE);
      if (!entries.length) increment(diagnostics, "feed_invalid");
      for (const entry of entries) {
        if (!entry.publishedAt) { increment(diagnostics, "missing_date"); continue; }
        if (now - entry.publishedAt > NEWS_CACHE_TTL_MS || entry.publishedAt > now + 60 * 60_000) { increment(diagnostics, "stale"); continue; }
        if (SENSITIVE.test(`${entry.title} ${entry.description} ${entry.topics.join(" ")}`)) { increment(diagnostics, "sensitive_topic"); continue; }
        try {
          const articleResponse = await fetcher(entry.url, { headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "AriDesktopCharacter/1.2 (+news-smalltalk)",
          } });
          if (articleResponse.status < 200 || articleResponse.status >= 300) throw new Error(`HTTP ${articleResponse.status}`);
          const metadata = extractArticleMetadata(articleResponse.body, entry.url);
          if (!metadata || (!metadata.description && !metadata.excerpt)) { increment(diagnostics, "missing_content"); continue; }
          const publishedAt = metadata.publishedAt;
          if (!publishedAt) { increment(diagnostics, "missing_date"); continue; }
          if (Math.abs(publishedAt - entry.publishedAt) > 36 * 60 * 60_000) {
            increment(diagnostics, "article_mismatch");
            continue;
          }
          if (!titleMatches(entry.title, metadata.title)) { increment(diagnostics, "article_mismatch"); continue; }
          const url = canonicalizeNewsUrl(metadata.canonicalUrl);
          if (!url) { increment(diagnostics, "unsafe_url"); continue; }
          const summary = (metadata.description || entry.description || metadata.excerpt).slice(0, 500).trim();
          const excerpt = metadata.excerpt.slice(0, 700).trim();
          if (!summary || !excerpt) { increment(diagnostics, "missing_content"); continue; }
          if (PROMPT_INJECTION.test(`${metadata.title} ${summary} ${excerpt}`)) {
            increment(diagnostics, "prompt_injection");
            continue;
          }
          collected.push({
            id: hash(`${url}|${publishedAt}`), title: metadata.title || entry.title, summary, excerpt, url,
            publisher: source.publisher, publishedAt, fetchedAt: now,
            topics: [...new Set([...entry.topics, ...normalizeNewsTitle(`${entry.title} ${summary}`).split(" ").filter((part) => part.length >= 5).slice(0, 10)])],
            language: /[а-яё]/i.test(`${entry.title} ${summary}`) ? "ru" : "en",
            verification: "feed_and_article", provenance: "untrusted_external_data", sourceWeight: source.sourceWeight,
          });
        } catch { increment(diagnostics, "missing_content"); }
      }
      status.status = "ok"; status.lastSuccessAt = now;
      status.itemCount = collected.filter((item) => item.publisher === source.publisher).length;
    } catch (error) {
      status.status = "error";
      status.error = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
    }
  }));

  const merged = dedupe([...collected, ...loadNewsCache(now)], diagnostics).slice(0, MAX_CACHE_ITEMS);
  storageWrite(CACHE_KEY, merged);
  const anySuccess = diagnostics.sourceStatuses.some((status) => status.status === "ok");
  const allSuccess = diagnostics.sourceStatuses.every((status) => status.status === "ok");
  if (anySuccess) diagnostics.lastRefreshAt = now;
  if (allSuccess) {
    consecutiveFailures = 0;
    diagnostics.nextRetryAt = undefined;
  } else {
    consecutiveFailures += 1;
    const delay = Math.min(30, 5 * 2 ** Math.max(0, consecutiveFailures - 1)) * 60_000;
    diagnostics.nextRetryAt = now + delay;
  }
  diagnostics.cacheSize = merged.length;
  saveDiagnostics(diagnostics);
  return merged;
}

export function refreshNewsCache(options: RefreshOptions = {}): Promise<NewsItem[]> {
  const now = options.now ?? Date.now();
  const diagnostics = getNewsDiagnostics();
  if (!options.force && diagnostics.nextRetryAt && now < diagnostics.nextRetryAt) return Promise.resolve(loadNewsCache(now));
  if (!options.force && !diagnostics.nextRetryAt && diagnostics.lastRefreshAt && now - diagnostics.lastRefreshAt < NEWS_REFRESH_INTERVAL_MS) {
    return Promise.resolve(loadNewsCache(now));
  }
  if (refreshPromise) return refreshPromise;
  refreshPromise = refreshInternal(options).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function rankNewsItems(options: { items?: NewsItem[]; contextTerms?: string[]; interestTerms?: string[]; now?: number }): RankedNewsItem[] {
  const now = options.now ?? Date.now();
  const context = tokens((options.contextTerms ?? []).join(" "));
  const interests = tokens((options.interestTerms ?? []).join(" "));
  const shown = loadShown(now);
  const shownIds = new Set(shown.map((entry) => entry.id));
  const shownTopics = new Set(shown.flatMap((entry) => [entry.titleKey, ...entry.topics.map(normalizeNewsTitle)]));
  return (options.items ?? loadNewsCache(now))
    .filter((item) => now - item.publishedAt <= NEWS_ELIGIBLE_AGE_MS && item.publishedAt <= now + 60_000)
    .filter((item) => !shownIds.has(item.id) && !shownTopics.has(normalizeNewsTitle(item.title)) && !item.topics.some((topic) => shownTopics.has(normalizeNewsTitle(topic))))
    .map((item) => {
      const itemTokens = tokens(`${item.title} ${item.summary} ${item.topics.join(" ")}`);
      const contextScore = overlap(context, itemTokens);
      const interestScore = overlap(interests, itemTokens);
      const freshness = Math.max(0, 1 - (now - item.publishedAt) / NEWS_ELIGIBLE_AGE_MS);
      const novelty = 1;
      return { item, score: 0.35 * contextScore + 0.25 * interestScore + 0.2 * freshness + 0.1 * item.sourceWeight + 0.1 * novelty };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectNewsItem(options: Parameters<typeof rankNewsItems>[0]): RankedNewsItem | null {
  const selected = rankNewsItems(options)[0] ?? null;
  if (selected) {
    const diagnostics = getNewsDiagnostics();
    diagnostics.lastSelected = { id: selected.item.id, title: selected.item.title, score: selected.score, at: options.now ?? Date.now() };
    saveDiagnostics(diagnostics);
  }
  return selected;
}

export function markNewsShown(item: NewsItem, now = Date.now()): void {
  const shown = loadShown(now);
  shown.unshift({ id: item.id, titleKey: normalizeNewsTitle(item.title), topics: [...item.topics], at: now, publisher: item.publisher, title: item.title });
  storageWrite(SHOWN_KEY, shown.slice(0, 300));
  const diagnostics = getNewsDiagnostics();
  diagnostics.lastShown = { id: item.id, title: item.title, publisher: item.publisher, at: now };
  saveDiagnostics(diagnostics);
}

export function resetNewsStateForTests(): void {
  refreshPromise = null; consecutiveFailures = 0;
  try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(SHOWN_KEY); localStorage.removeItem(DIAGNOSTICS_KEY); } catch { /* noop */ }
}
