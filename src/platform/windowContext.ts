export type AppCategory =
  | "coding"
  | "browser"
  | "communication"
  | "entertainment"
  | "other";

export type EditorContext = {
  repo?: string;
  file?: string;
  branch?: string;
};

const DEFAULT_CODING_PATTERN =
  /code|devenv|idea|pycharm|webstorm|rustrover|cursor|zed|sublime|vim|neovim|nvim|emacs|eclipse|android studio|fleet|windsurf|visual studio|WindowsTerminal|wt\.exe|powershell|cmd\.exe|terminal|iterm|alacritty|wezterm|hyper/i;

const DEFAULT_DISTRACTOR_PATTERN =
  /youtube|netflix|twitch|tiktok|instagram|reddit|twitter|x\.com|discord|steam|game|vk\.com|pikabu|telegram|facebook|spotify|roblox|minecraft/i;

const BROWSER_PATTERN =
  /chrome|firefox|msedge|edge|brave|opera|safari|vivaldi|browser/i;

const COMMUNICATION_PATTERN =
  /slack|teams|zoom|skype|whatsapp|signal|mattermost|discord|telegram|outlook|thunderbird/i;

export function buildCodingPattern(extra = ""): RegExp {
  const trimmed = extra.trim();
  if (!trimmed) {
    return DEFAULT_CODING_PATTERN;
  }
  const escaped = trimmed
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return escaped
    ? new RegExp(`${DEFAULT_CODING_PATTERN.source}|${escaped}`, "i")
    : DEFAULT_CODING_PATTERN;
}

export function buildDistractorPattern(extra = ""): RegExp {
  const trimmed = extra.trim();
  if (!trimmed) {
    return DEFAULT_DISTRACTOR_PATTERN;
  }
  const escaped = trimmed
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return escaped
    ? new RegExp(`${DEFAULT_DISTRACTOR_PATTERN.source}|${escaped}`, "i")
    : DEFAULT_DISTRACTOR_PATTERN;
}

export function categorizeApp(process: string, title = ""): AppCategory {
  const haystack = `${process} ${title}`.toLowerCase();
  if (DEFAULT_CODING_PATTERN.test(haystack)) {
    return "coding";
  }
  if (BROWSER_PATTERN.test(haystack)) {
    return "browser";
  }
  if (COMMUNICATION_PATTERN.test(haystack)) {
    return "communication";
  }
  if (DEFAULT_DISTRACTOR_PATTERN.test(haystack)) {
    return "entertainment";
  }
  return "other";
}

export function parseBrowserSearchTopic(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) {
    return null;
  }

  const searchMatch = trimmed.match(
    /^(.+?)\s[-—–]\s(?:Google(?:\sSearch)?|Поиск(?:\sв\sGoogle)?|Yandex|Яндекс|Bing|DuckDuckGo)/i,
  );
  if (searchMatch?.[1]) {
    return searchMatch[1].trim().slice(0, 160);
  }

  const docsMatch = trimmed.match(
    /^(.+?)\s[-—–]\s(?:Stack\sOverflow|GitHub|MDN\sWeb\sDocs|Microsoft\sDocs|docs\.)/i,
  );
  if (docsMatch?.[1]) {
    return docsMatch[1].trim().slice(0, 160);
  }

  const pipeMatch = trimmed.match(/^(.+?)\s\|\s.+/);
  if (pipeMatch?.[1] && BROWSER_PATTERN.test(trimmed)) {
    const candidate = pipeMatch[1].trim();
    if (candidate.length >= 4 && candidate.length <= 120) {
      return candidate;
    }
  }

  return null;
}

export function parseEditorContext(title: string): EditorContext {
  const trimmed = title.trim();
  if (!trimmed) {
    return {};
  }

  const vscodeMatch = trimmed.match(
    /^(?:\[[^\]]+\]\s*)?(.+?)\s*[-—–]\s*(.+?)(?:\s*[-—–]\s*(.+))?$/,
  );
  if (vscodeMatch) {
    const [, file, repo, branch] = vscodeMatch;
    return {
      file: file?.trim(),
      repo: repo?.trim(),
      branch: branch?.trim(),
    };
  }

  const branchMatch = trimmed.match(/\(([^)]+)\)\s*[-—–]\s*(.+)$/);
  if (branchMatch) {
    return {
      branch: branchMatch[1]?.trim(),
      file: branchMatch[2]?.trim(),
    };
  }

  return { file: trimmed.slice(0, 160) };
}

export function isCodingProcess(
  processName: string,
  extraPattern = "",
): boolean {
  return buildCodingPattern(extraPattern).test(processName);
}

export function isDistractingWindow(
  processName: string,
  title = "",
  extraPattern = "",
): boolean {
  const haystack = `${processName} ${title}`;
  return buildDistractorPattern(extraPattern).test(haystack);
}

export function countRapidContextSwitches(
  switchTimestamps: number[],
  windowMs = 5 * 60_000,
  threshold = 6,
  now = Date.now(),
): number {
  const recent = switchTimestamps.filter((at) => now - at <= windowMs);
  return recent.length >= threshold ? recent.length : 0;
}
