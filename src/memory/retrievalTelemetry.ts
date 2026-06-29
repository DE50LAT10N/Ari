export type RetrievalSearchMode = "linear" | "ivf" | "none";

export type RetrievalPassRecord = {
  query: string;
  ragIn: number;
  ragOut: number;
  factsIn: number;
  factsOut: number;
  episodesIn: number;
  episodesOut: number;
  searchMode: RetrievalSearchMode;
  mmrApplied: boolean;
  llmRerankApplied: boolean;
  ms: number;
  at: number;
};

const RETRIEVAL_KEY = "desktop-character.retrieval-telemetry.v1";

function readPasses(): RetrievalPassRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RETRIEVAL_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as RetrievalPassRecord[]) : [];
  } catch {
    return [];
  }
}

function writePasses(passes: RetrievalPassRecord[]): void {
  localStorage.setItem(RETRIEVAL_KEY, JSON.stringify(passes.slice(-12)));
}

export function recordRetrievalPass(record: Omit<RetrievalPassRecord, "at">): void {
  const next = readPasses();
  next.push({ ...record, at: Date.now() });
  writePasses(next);
}

export type RetrievalHealthSnapshot = {
  lastPasses: RetrievalPassRecord[];
  avgShrinkRatio: number;
  ivfShare: number;
  mmrShare: number;
};

export function getRetrievalHealthSnapshot(): RetrievalHealthSnapshot {
  const lastPasses = readPasses().slice(-5);
  if (!lastPasses.length) {
    return {
      lastPasses: [],
      avgShrinkRatio: 0,
      ivfShare: 0,
      mmrShare: 0,
    };
  }

  let shrinkSum = 0;
  let shrinkCount = 0;
  let ivfCount = 0;
  let mmrCount = 0;

  for (const pass of lastPasses) {
    const inTotal = pass.ragIn + pass.factsIn + pass.episodesIn;
    const outTotal = pass.ragOut + pass.factsOut + pass.episodesOut;
    if (inTotal > 0) {
      shrinkSum += outTotal / inTotal;
      shrinkCount += 1;
    }
    if (pass.searchMode === "ivf") {
      ivfCount += 1;
    }
    if (pass.mmrApplied) {
      mmrCount += 1;
    }
  }

  return {
    lastPasses,
    avgShrinkRatio: shrinkCount ? shrinkSum / shrinkCount : 0,
    ivfShare: ivfCount / lastPasses.length,
    mmrShare: mmrCount / lastPasses.length,
  };
}
