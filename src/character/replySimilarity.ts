function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/<emotion>[^<]+<\/emotion>/gi, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(
    normalizeReply(text)
      .split(" ")
      .filter((word) => word.length >= 3),
  );
}

export function replySimilarity(left: string, right: string): number {
  const leftWords = wordSet(left);
  const rightWords = wordSet(right);
  if (!leftWords.size || !rightWords.size) {
    return 0;
  }
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(leftWords.size, rightWords.size);
}

export function isTooSimilarToRecent(
  reply: string,
  recentReplies: string[],
  threshold = 0.72,
): boolean {
  const normalized = normalizeReply(reply);
  if (!normalized) {
    return false;
  }
  return recentReplies.some((recent) => {
    const normalizedRecent = normalizeReply(recent);
    if (!normalizedRecent) {
      return false;
    }
    if (normalized === normalizedRecent) {
      return true;
    }
    return replySimilarity(reply, recent) >= threshold;
  });
}
