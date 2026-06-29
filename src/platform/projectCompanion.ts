import { invoke } from "@tauri-apps/api/core";

export type BinderFileEntry = {
  relativePath: string;
  modifiedAt: number;
  sizeBytes: number;
};

export type GitStatusSummary = {
  branch: string;
  isRepo: boolean;
  changed: string[];
  untracked: string[];
  staged: string[];
};

export type GitCommitEntry = {
  hash: string;
  subject: string;
};

const DEFAULT_EXTENSIONS = [
  "md",
  "txt",
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "rs",
  "toml",
  "css",
  "html",
  "yaml",
  "yml",
];

export async function listBinderFiles(
  rootPath: string,
  options?: {
    allowedExtensions?: string[];
    maxDepth?: number;
    limit?: number;
  },
): Promise<BinderFileEntry[]> {
  return invoke<BinderFileEntry[]>("binder_list_files", {
    request: {
      rootPath,
      allowedExtensions: options?.allowedExtensions ?? DEFAULT_EXTENSIONS,
      maxDepth: options?.maxDepth ?? 6,
      limit: options?.limit ?? 200,
    },
  });
}

export async function readBinderFile(
  rootPath: string,
  relativePath: string,
  allowedExtensions?: string[],
): Promise<string> {
  return invoke<string>("binder_read_file", {
    request: {
      rootPath,
      relativePath,
      allowedExtensions: allowedExtensions ?? DEFAULT_EXTENSIONS,
    },
  });
}

export async function fetchGitStatusSummary(
  rootPath: string,
): Promise<GitStatusSummary> {
  return invoke<GitStatusSummary>("git_status_summary", { rootPath });
}

export async function fetchGitRecentCommits(
  rootPath: string,
  limit = 8,
): Promise<GitCommitEntry[]> {
  return invoke<GitCommitEntry[]>("git_recent_commits", { rootPath, limit });
}

export async function fetchGitFileDiff(
  rootPath: string,
  relativePath?: string,
): Promise<string> {
  return invoke<string>("git_file_diff", {
    request: {
      rootPath,
      relativePath,
    },
  });
}
