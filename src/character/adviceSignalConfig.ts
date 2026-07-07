export type AdviceSignalConfig = {
  clipboardFreshMs: number;
  workingMemoryRecentMs: number;
  queryFreshMs: number;
  lowUrgencyRepeatCapMs: number;
  highScoreMin: number;
  mediumScoreMin: number;
  lowScoreMin: number;
  activeWorkSessionMin: number;
  longWorkSessionMin: number;
};

export const ADVICE_SIGNAL_CONFIG: AdviceSignalConfig = {
  clipboardFreshMs: 15 * 60_000,
  workingMemoryRecentMs: 20 * 60_000,
  queryFreshMs: 45 * 60_000,
  lowUrgencyRepeatCapMs: 25 * 60_000,
  highScoreMin: 6,
  mediumScoreMin: 3,
  lowScoreMin: 1,
  activeWorkSessionMin: 5,
  longWorkSessionMin: 12,
};

export type VisibleReplyQualityConfig = {
  maxVisibleAdviceChars: number;
  maxIdentifiersChecked: number;
};

export const VISIBLE_REPLY_QUALITY_CONFIG: VisibleReplyQualityConfig = {
  maxVisibleAdviceChars: 320,
  maxIdentifiersChecked: 8,
};

export type AdviceQualityScore = {
  grounding: number;
  specificity: number;
  actionability: number;
  novelty: number;
  voiceSafety: number;
  issues: string[];
};

export const PASSING_ADVICE_QUALITY: AdviceQualityScore = {
  grounding: 1,
  specificity: 1,
  actionability: 1,
  novelty: 1,
  voiceSafety: 1,
  issues: [],
};
