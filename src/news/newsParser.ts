export type ParsedFeedItem = {
  title: string;
  url: string;
  publishedAt?: number;
  description: string;
  topics: string[];
};

export type ArticleMetadata = {
  title: string;
  description: string;
  excerpt: string;
  publishedAt?: number;
  canonicalUrl: string;
};

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(x?[0-9a-f]+);/gi, (_, raw: string) => {
      const radix = raw[0].toLowerCase() === "x" ? 16 : 10;
      const parsed = Number.parseInt(radix === 16 ? raw.slice(1) : raw, radix);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed)
        : "";
    })
    .replace(/&([a-z]+);/gi, (all, name: string) => ENTITY_MAP[name.toLowerCase()] ?? all);
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagText(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return cleanText(match[1]);
  }
  return "";
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function parseDate(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveHttpsUrl(value: string, baseUrl?: string): string | undefined {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function canonicalizeNewsUrl(value: string, baseUrl?: string): string | undefined {
  const safe = resolveHttpsUrl(value, baseUrl);
  if (!safe) return undefined;
  const url = new URL(safe);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|ref|source|campaign|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function normalizeNewsTitle(value: string): string {
  return cleanText(value)
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFeed(xml: string, feedUrl: string): ParsedFeedItem[] {
  if (!xml || !/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) return [];
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return blocks.flatMap((match) => {
    const kind = match[1].toLowerCase();
    const block = match[2];
    const title = tagText(block, ["title"]);
    let rawLink = tagText(block, ["link", "guid"]);
    if (kind === "entry") {
      const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((entry) => entry[0]);
      const preferred = links.find((tag) => !attr(tag, "rel") || attr(tag, "rel") === "alternate") ?? links[0];
      rawLink = preferred ? attr(preferred, "href") : rawLink;
    }
    const url = canonicalizeNewsUrl(rawLink, feedUrl);
    if (!title || !url) return [];
    const dateText = tagText(block, ["pubDate", "published", "updated", "dc:date"]);
    const description = tagText(block, ["description", "summary", "content", "content:encoded"]);
    const topics = [...block.matchAll(/<(?:category|dc:subject)\b[^>]*>([\s\S]*?)<\/(?:category|dc:subject)>/gi)]
      .map((entry) => cleanText(entry[1]))
      .filter(Boolean)
      .slice(0, 8);
    return [{ title, url, publishedAt: parseDate(dateText), description, topics }];
  });
}

function metaContent(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = attr(tag, "property") || attr(tag, "name") || attr(tag, "itemprop");
    if (property.toLowerCase() === key.toLowerCase()) return cleanText(attr(tag, "content"));
  }
  return "";
}

function jsonLdObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdObjects);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const nested = jsonLdObjects(record["@graph"]);
  return [record, ...nested];
}

export function extractArticleMetadata(html: string, articleUrl: string): ArticleMetadata | null {
  const safeInput = canonicalizeNewsUrl(articleUrl);
  if (!safeInput || !html.trim()) return null;
  const withoutActive = html
    .replace(/<script\b(?![^>]*type\s*=\s*["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<(?:style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/(?:style|noscript|svg|template)>/gi, " ");

  let jsonTitle = "";
  let jsonDescription = "";
  let jsonDate = "";
  let jsonUrl = "";
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1]));
      for (const object of jsonLdObjects(parsed)) {
        jsonTitle ||= typeof object.headline === "string" ? object.headline : "";
        jsonDescription ||= typeof object.description === "string" ? object.description : "";
        jsonDate ||= typeof object.datePublished === "string" ? object.datePublished : "";
        jsonUrl ||= typeof object.url === "string" ? object.url : "";
      }
    } catch {
      // Broken or adversarial JSON-LD is ignored; other metadata can still verify the page.
    }
  }

  const title = cleanText(jsonTitle || metaContent(html, "og:title") || tagText(html, ["title"]));
  const description = cleanText(jsonDescription || metaContent(html, "og:description") || metaContent(html, "description"));
  const timeTag = html.match(/<time\b[^>]*>/i)?.[0] ?? "";
  const publishedAt = parseDate(jsonDate || metaContent(html, "article:published_time") || attr(timeTag, "datetime"));
  const canonicalTag = (html.match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>/i) ?? [""])[0];
  const canonicalUrl = canonicalizeNewsUrl(jsonUrl || attr(canonicalTag, "href") || safeInput, safeInput) ?? safeInput;
  const body = cleanText(withoutActive.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " "));
  const excerpt = body.slice(0, 700).trim();
  if (!title || (!description && excerpt.length < 80)) return null;
  return { title, description, excerpt, publishedAt, canonicalUrl };
}
