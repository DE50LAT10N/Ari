export type RagSearchPlan = {
  queries: string[];
  documentHint?: string;
  itemNumber?: number;
  explicitRag: boolean;
  documentLookup: boolean;
};

const EXPLICIT_RAG_PATTERN =
  /(?:используй\s+rag|через\s+rag|по\s+rag|rag\s+поиск|по\s+документам|из\s+документов|в\s+индекс(?:е)?)/i;

const DOCUMENT_LOOKUP_PATTERN =
  /(?:документ(?:е|а)?|файл(?:е|а)?|вопрос\s*(?:№|под\s+номером)|под\s+номером|пункт\s*№?|п\.?\s*\d+)/i;

const DOCUMENT_HINT_PATTERN =
  /(?:документ(?:е|а)?|файл(?:е|а)?)\s+["«]?([^"»\n]+?)(?:["»]|$|\s+под|\s+вопрос|\s+номер)/i;

const QUOTED_DOCUMENT_PATTERN = /["«]([^"»\n]{3,80})["»]/;
const QUOTED_PHRASE_PATTERN = /["«]([^"»\n]{3,160})["»]/g;

const ITEM_NUMBER_PATTERN =
  /(?:номер(?:ом)?|номером|№|п\.|пункт(?:ом)?|вопрос(?:ом)?)\s*(\d{1,3})/i;

const META_PHRASE_PATTERN =
  /(?:используй\s+rag|посмотри\s+через\s+rag|через\s+rag|по\s+rag|rag\s*,?|посмотри\s+в\s+документ(?:е|ах)?|найди\s+в\s+документ(?:е|ах)?|поищи\s+в\s+документ(?:е|ах)?)/gi;

export function normalizeDocumentSourceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/["«»]/g, "")
    .replace(/\.(pdf|md|txt|json|docx?|markdown)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueQueries(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function extractDocumentHint(message: string): string | undefined {
  const quoted = message.match(QUOTED_DOCUMENT_PATTERN)?.[1]?.trim();
  if (quoted && quoted.length >= 3) {
    return quoted;
  }
  const fromLabel = message.match(DOCUMENT_HINT_PATTERN)?.[1]?.trim();
  if (fromLabel && fromLabel.length >= 3) {
    return fromLabel.replace(/\s+под\s+номером.*$/i, "").trim();
  }
  const bareDocument = message.match(
    /(?:документ(?:е|а)?|файл(?:е|а)?)\s+([^\n,?]{3,80})/i,
  )?.[1];
  if (bareDocument) {
    return bareDocument
      .replace(/\s+под\s+номером.*$/i, "")
      .replace(/\s+вопрос.*$/i, "")
      .trim();
  }
  return undefined;
}

function extractItemNumber(message: string): number | undefined {
  const match = message.match(ITEM_NUMBER_PATTERN);
  if (!match) {
    return undefined;
  }
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : undefined;
}

function cleanRagQuery(message: string): string {
  return message
    .replace(META_PHRASE_PATTERN, " ")
    .replace(/\b(?:в|из)\s+документ(?:е|а)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQuotedPhrases(message: string): string[] {
  const phrases: string[] = [];
  for (const match of message.matchAll(QUOTED_PHRASE_PATTERN)) {
    const value = match[1]?.trim();
    if (value) {
      phrases.push(value);
    }
  }
  return phrases;
}

function extractNumberQuery(message: string): string | undefined {
  const numbers = message.match(/\b\d{1,6}\b/g);
  if (!numbers?.length) {
    return undefined;
  }
  const unique = [...new Set(numbers)].slice(0, 6);
  return unique.length ? unique.join(" ") : undefined;
}

export function buildRagSearchPlan(message: string): RagSearchPlan {
  const normalized = message.trim();
  const explicitRag = EXPLICIT_RAG_PATTERN.test(normalized);
  const documentHint = extractDocumentHint(normalized);
  const itemNumber = extractItemNumber(normalized);
  const cleaned = cleanRagQuery(normalized);
  const quotedPhrases = extractQuotedPhrases(normalized);
  const numberQuery = extractNumberQuery(normalized);
  const documentLookup =
    explicitRag ||
    Boolean(documentHint) ||
    itemNumber !== undefined ||
    DOCUMENT_LOOKUP_PATTERN.test(normalized);

  const queries: string[] = [];
  if (cleaned) {
    queries.push(cleaned);
  }
  quotedPhrases.forEach((phrase) => queries.push(phrase));
  if (numberQuery) {
    queries.push(numberQuery);
  }
  if (documentHint && itemNumber !== undefined) {
    queries.push(`${documentHint} вопрос ${itemNumber}`);
    queries.push(`${documentHint} ${itemNumber}`);
  } else if (documentHint) {
    queries.push(documentHint);
  } else if (itemNumber !== undefined) {
    queries.push(`вопрос ${itemNumber}`);
  }
  if (!queries.length && normalized) {
    queries.push(normalized);
  }

  return {
    queries: uniqueQueries(queries).slice(0, 4),
    documentHint,
    itemNumber,
    explicitRag,
    documentLookup,
  };
}

export function hasDocumentLookupIntent(message: string): boolean {
  return buildRagSearchPlan(message).documentLookup;
}
