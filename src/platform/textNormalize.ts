/** Normalize text for overlap / similarity checks (reply, advice novelty). */
export function normalizeForOverlap(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/<emotion>[^<]+<\/emotion>/gi, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize text for memory deduplication / comparable keys. */
export function normalizeComparableText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
