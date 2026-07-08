export type ProcessProfileKind =
  | "ide"
  | "terminal"
  | "browser"
  | "communication"
  | "entertainment"
  | "other";

export type ProcessProfileInput = {
  processName?: string | null;
  title?: string | null;
  editorFile?: string | null;
};

export type ProcessProfileFlags = {
  ide: boolean;
  terminal: boolean;
  browser: boolean;
  communication: boolean;
  entertainment: boolean;
};

const PROFILE_TOKENS: Record<Exclude<ProcessProfileKind, "other">, string[]> = {
  ide: [
    "code",
    "cursor",
    "devenv",
    "idea",
    "pycharm",
    "webstorm",
    "rider",
    "rustrover",
    "zed",
    "sublime",
    "vim",
    "neovim",
    "nvim",
    "emacs",
    "eclipse",
    "android studio",
    "fleet",
    "windsurf",
    "visual studio",
    "notepad++",
  ],
  terminal: [
    "terminal",
    "powershell",
    "pwsh",
    "cmd",
    "wt",
    "windows terminal",
    "windowsterminal",
    "wezterm",
    "alacritty",
    "iterm",
    "hyper",
  ],
  browser: [
    "chrome",
    "firefox",
    "msedge",
    "edge",
    "brave",
    "opera",
    "safari",
    "vivaldi",
    "browser",
  ],
  communication: [
    "slack",
    "teams",
    "zoom",
    "skype",
    "whatsapp",
    "signal",
    "mattermost",
    "discord",
    "telegram",
    "outlook",
    "thunderbird",
    "mail",
  ],
  entertainment: [
    "youtube",
    "netflix",
    "twitch",
    "tiktok",
    "instagram",
    "reddit",
    "twitter",
    "x.com",
    "steam",
    "game",
    "vk.com",
    "pikabu",
    "spotify",
    "roblox",
    "minecraft",
  ],
};

const SOURCE_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "kt",
  "md",
  "py",
  "rs",
  "tsx",
  "ts",
  "toml",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

function normalizeProcessText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.(?:exe|app)\b/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}.+#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeProcessText(value).split(" ").filter(Boolean));
}

function hasProfileToken(text: string, tokens: Set<string>, token: string): boolean {
  const normalized = normalizeProcessText(token);
  if (!normalized) {
    return false;
  }
  if (normalized.includes(" ")) {
    return text.includes(normalized);
  }
  return tokens.has(normalized);
}

export function looksLikeSourceFile(value?: string | null): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  const withoutQuery = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  const lastSegment = withoutQuery.split(/[\\/]/).pop() ?? withoutQuery;
  const extension = lastSegment.includes(".")
    ? lastSegment.split(".").pop()?.toLowerCase()
    : undefined;
  return Boolean(extension && SOURCE_FILE_EXTENSIONS.has(extension));
}

export function classifyProcessProfiles(input: ProcessProfileInput): ProcessProfileFlags {
  const haystack = normalizeProcessText(
    [input.processName, input.title, input.editorFile].filter(Boolean).join(" "),
  );
  const tokens = tokenSet(haystack);
  const has = (kind: Exclude<ProcessProfileKind, "other">): boolean =>
    PROFILE_TOKENS[kind].some((token) => hasProfileToken(haystack, tokens, token));

  return {
    ide: has("ide") || looksLikeSourceFile(input.editorFile ?? input.title),
    terminal: has("terminal"),
    browser: has("browser"),
    communication: has("communication"),
    entertainment: has("entertainment"),
  };
}

export function primaryProcessProfile(input: ProcessProfileInput): ProcessProfileKind {
  const flags = classifyProcessProfiles(input);
  if (flags.terminal) return "terminal";
  if (flags.ide) return "ide";
  if (flags.browser) return "browser";
  if (flags.communication) return "communication";
  if (flags.entertainment) return "entertainment";
  return "other";
}
