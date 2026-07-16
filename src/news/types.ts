export type NewsVerificationLevel = "feed_and_article";

export type NewsItem = Readonly<{
  id: string;
  title: string;
  summary: string;
  excerpt: string;
  url: string;
  publisher: string;
  publishedAt: number;
  fetchedAt: number;
  topics: readonly string[];
  language: string;
  verification: NewsVerificationLevel;
  provenance: "untrusted_external_data";
  sourceWeight: number;
}>;

export type NewsSource = {
  id: string;
  publisher: string;
  feedUrl: string;
  sourceWeight: number;
};

export type NewsSourceStatus = {
  sourceId: string;
  publisher: string;
  status: "idle" | "loading" | "ok" | "error";
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  itemCount: number;
  error?: string;
};

export type NewsRejectionReason =
  | "feed_invalid"
  | "unsafe_url"
  | "missing_date"
  | "missing_content"
  | "article_mismatch"
  | "prompt_injection"
  | "sensitive_topic"
  | "stale"
  | "duplicate";

export type NewsDiagnostics = {
  lastRefreshAt?: number;
  lastRefreshAttemptAt?: number;
  nextRetryAt?: number;
  cacheSize: number;
  sourceStatuses: NewsSourceStatus[];
  rejectionCounts: Partial<Record<NewsRejectionReason, number>>;
  lastSelected?: { id: string; title: string; score: number; at: number };
  lastShown?: { id: string; title: string; publisher: string; at: number };
};

export type RankedNewsItem = { item: NewsItem; score: number };
