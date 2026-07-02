import type { AppSettings } from "../settings/appSettings";
import type { InitiativeSignalBundle } from "./initiativeContext";
import {
  getActiveProjectBinder,
  listRecentProjectFiles,
  normalizeProjectRelativePath,
  readProjectFile,
} from "./projectBinder";

export type ProactiveCodeExcerpt = {
  file: string;
  relativePath: string;
  text: string;
  truncated: boolean;
};

type ResolvedProjectFile = {
  rootPath: string;
  relativePath: string;
  file: string;
};

function basename(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function normalizeCaseFold(input: string): string {
  return input.trim().toLowerCase();
}

function pickBestCandidate(
  candidates: Array<{ relativePath: string }>,
  editorRepo?: string,
): { relativePath: string } | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0]!;

  const repoHint = editorRepo ? normalizeCaseFold(editorRepo) : "";
  if (repoHint) {
    const repoMatches = candidates.filter((candidate) =>
      normalizeCaseFold(candidate.relativePath).includes(repoHint),
    );
    if (repoMatches.length === 1) return repoMatches[0]!;
    if (repoMatches.length > 1) {
      return repoMatches
        .slice()
        .sort((a, b) => a.relativePath.length - b.relativePath.length)[0]!;
    }
  }

  return candidates
    .slice()
    .sort((a, b) => a.relativePath.length - b.relativePath.length)[0]!;
}

function resolveFromRelativePath(
  active: NonNullable<ReturnType<typeof getActiveProjectBinder>>,
  relativePath: string,
): ResolvedProjectFile | null {
  const normalized = normalizeProjectRelativePath(relativePath);
  if (!normalized) return null;
  return {
    rootPath: active.rootPath,
    relativePath: normalized,
    file: basename(normalized),
  };
}

function matchPinnedPath(
  pinnedPaths: string[],
  editorFile: string,
  targetBase: string,
): string | null {
  const normalizedEditor = normalizeProjectRelativePath(editorFile);
  for (const pinned of pinnedPaths) {
    const normalizedPinned = normalizeProjectRelativePath(pinned);
    if (normalizeCaseFold(normalizedPinned) === normalizeCaseFold(normalizedEditor)) {
      return normalizedPinned;
    }
    if (normalizeCaseFold(basename(normalizedPinned)) === targetBase) {
      return normalizedPinned;
    }
  }
  return null;
}

export async function resolveEditorFileInProject(input: {
  editorFile?: string;
  editorRepo?: string;
}): Promise<ResolvedProjectFile | null> {
  const active = getActiveProjectBinder();
  if (!active?.rootPath) return null;
  const editorFile = input.editorFile?.trim();
  if (!editorFile) return null;

  const targetBase = normalizeCaseFold(basename(editorFile));
  if (!targetBase) return null;

  const pinnedMatch = matchPinnedPath(active.pinnedPaths ?? [], editorFile, targetBase);
  if (pinnedMatch) {
    return resolveFromRelativePath(active, pinnedMatch);
  }

  const looksLikePath = /[\\/]/.test(editorFile);
  if (looksLikePath) {
    const direct = resolveFromRelativePath(active, editorFile);
    if (direct) return direct;
  }

  const entries = await listRecentProjectFiles(active, 500);
  if (looksLikePath) {
    const normalizedEditor = normalizeProjectRelativePath(editorFile);
    const directEntry = entries.find(
      (entry) =>
        normalizeCaseFold(entry.relativePath) === normalizeCaseFold(normalizedEditor),
    );
    if (directEntry) {
      return resolveFromRelativePath(active, directEntry.relativePath);
    }
  }

  const candidates = entries
    .filter((entry) => normalizeCaseFold(basename(entry.relativePath)) === targetBase)
    .map((entry) => ({ relativePath: entry.relativePath }));

  const picked = pickBestCandidate(candidates, input.editorRepo);
  if (!picked) return null;

  return resolveFromRelativePath(active, picked.relativePath);
}

function buildBoundedExcerpt(input: {
  fullText: string;
  anchor?: string;
  maxChars: number;
}): { excerpt: string; truncated: boolean } {
  const full = input.fullText ?? "";
  const maxChars = Math.max(200, input.maxChars);
  if (full.length <= maxChars) {
    return { excerpt: full, truncated: false };
  }

  const anchor = input.anchor?.trim();
  if (anchor && anchor.length >= 8) {
    const index = full.indexOf(anchor);
    if (index >= 0) {
      const half = Math.floor(maxChars / 2);
      const start = Math.max(0, index - half);
      const end = Math.min(full.length, start + maxChars);
      const excerpt = full.slice(start, end);
      return {
        excerpt,
        truncated: excerpt.length < full.length,
      };
    }
  }

  return { excerpt: full.slice(0, maxChars), truncated: true };
}

let cache:
  | {
      at: number;
      relativePath: string;
      excerpt: ProactiveCodeExcerpt;
    }
  | null = null;

export async function loadCurrentCodeExcerpt(
  settings: AppSettings,
  bundle: InitiativeSignalBundle,
): Promise<ProactiveCodeExcerpt | null> {
  if (!settings.adviceCodeReadingEnabled) return null;
  if (!settings.activityTrackingEnabled) return null;
  if (!settings.advisorEnabled) return null;

  const resolved = await resolveEditorFileInProject({
    editorFile: bundle.editorFile,
    editorRepo: bundle.editorRepo,
  });
  if (!resolved) return null;

  const now = Date.now();
  if (
    cache &&
    now - cache.at <= 60_000 &&
    cache.relativePath === resolved.relativePath
  ) {
    return cache.excerpt;
  }

  const fullText = await readProjectFile(resolved.relativePath);
  const clipAnchor =
    bundle.clipboardSnippets?.length
      ? bundle.clipboardSnippets[bundle.clipboardSnippets.length - 1]?.text
      : undefined;
  const bounded = buildBoundedExcerpt({
    fullText,
    anchor: clipAnchor,
    maxChars: 1800,
  });

  const excerpt: ProactiveCodeExcerpt = {
    file: resolved.file,
    relativePath: resolved.relativePath,
    text: bounded.excerpt,
    truncated: bounded.truncated,
  };
  cache = { at: now, relativePath: resolved.relativePath, excerpt };
  return excerpt;
}

