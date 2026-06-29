import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const emotionPattern =
  "neutral|happy|amused|annoyed|curious|empathetic|blush|bored|calm|surprised";

function stripEmotionMarkup(content) {
  const leading = new RegExp(
    `^\\s*(?:<emotion>\\s*(?:${emotionPattern})\\s*</emotion>|<(?:${emotionPattern})\\s*>|emotion\\s*[:\\-]?\\s*(?:${emotionPattern})\\b|(?:${emotionPattern})(?=\\s*(?:\\r?\\n|$)))\\s*(?:\\r?\\n)?`,
    "i",
  );
  return content.replace(leading, "").trimStart();
}

assert.equal(stripEmotionMarkup("emotion neutral\nПривет."), "Привет.");

const AUTO_COMMIT_CONFIDENCE_THRESHOLD = 0.85;

function shouldAutoCommitFact(fact) {
  return (
    (fact.importance === "core" || fact.importance === "important") &&
    fact.confidence >= AUTO_COMMIT_CONFIDENCE_THRESHOLD
  );
}

function shouldAutoCommitOpenLoop(loop) {
  if (loop.dueAt) return false;
  const confidence = loop.confidence ?? 0.7;
  return confidence >= AUTO_COMMIT_CONFIDENCE_THRESHOLD && loop.text.trim().length >= 12;
}

assert.equal(
  shouldAutoCommitFact({ importance: "core", confidence: 0.9 }),
  true,
);
assert.equal(
  shouldAutoCommitFact({ importance: "useful", confidence: 0.95 }),
  false,
);
assert.equal(
  shouldAutoCommitOpenLoop({ text: "доделать рефакторинг auth", confidence: 0.9 }),
  true,
);
assert.equal(
  shouldAutoCommitOpenLoop({
    text: "напомнить завтра",
    confidence: 0.95,
    dueAt: Date.now() + 86_400_000,
  }),
  false,
);

function dedupeFactsAgainstSummaries(facts, summaries) {
  const coveredIds = new Set(summaries.flatMap((summary) => summary.factIds));
  if (!coveredIds.size) return facts;
  return facts.filter((fact) => !coveredIds.has(fact.id));
}

const deduped = dedupeFactsAgainstSummaries(
  [
    { id: "a", text: "любит кофе" },
    { id: "b", text: "работает над Ari" },
  ],
  [{ factIds: ["a"], title: "напитки", text: "кофе" }],
);
assert.equal(deduped.length, 1);
assert.equal(deduped[0].id, "b");

const pcCooldowns = {
  build_success: 18 * 60_000,
  build_fail: 12 * 60_000,
  window_switch: 20 * 60_000,
  long_focus: 45 * 60_000,
  return_from_idle: 10 * 60_000,
  error_detected: 10 * 60_000,
};

const lastTriggered = new Map();
function canTriggerPcReaction(kind, { chatOpen }, allowWhenChatOpen = false) {
  if (!allowWhenChatOpen && chatOpen) return false;
  const last = lastTriggered.get(kind) ?? 0;
  return Date.now() - last >= pcCooldowns[kind];
}
function markPcReactionTriggered(kind) {
  lastTriggered.set(kind, Date.now());
}

assert.equal(canTriggerPcReaction("build_success", { chatOpen: false }), true);
assert.equal(
  canTriggerPcReaction("build_success", { chatOpen: true }, false),
  false,
);
markPcReactionTriggered("build_success");
assert.equal(canTriggerPcReaction("build_success", { chatOpen: false }), false);

function detectNonBuildPcError(processName, windowTitle) {
  if (!/(code|terminal|powershell)/i.test(processName)) return null;
  const title = windowTitle.toLowerCase();
  if (/(build failed|build succeeded)/i.test(title)) return null;
  if (/(error|exception|ошибк)/i.test(title)) return "error_detected";
  return null;
}

assert.equal(
  detectNonBuildPcError("Code.exe", "TypeError: cannot read property"),
  "error_detected",
);
assert.equal(
  detectNonBuildPcError("Code.exe", "Build failed - 3 errors"),
  null,
);

// memoryScoring regression (mirrors src/memory/memoryScoring.ts)
const RU_STOP = new Set(["и", "в", "на", "с", "не", "что", "как"]);
function stem(word) {
  if (word.length <= 3) return word;
  for (const suffix of ["ает", "ить", "ный", "ого", "ами", "ями"]) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((word) => word.length >= 2)
    .filter((word) => !RU_STOP.has(word))
    .map(stem);
}
function overlap(text, words) {
  const tokens = new Set(tokenize(text));
  return [...words].filter((word) => tokens.has(word)).length;
}
function mixed(lexical, semantic) {
  return semantic <= 0 ? lexical : lexical * 0.55 + semantic * 8;
}
const queryWords = new Set(tokenize("любит кофе"));
assert.ok(overlap("он любит кофе по утрам", queryWords) >= 1);
const lexicalScore = overlap("проект Ari desktop", new Set(tokenize("Ari проект")));
assert.ok(mixed(lexicalScore, 0.5) > lexicalScore);
assert.equal(mixed(lexicalScore, 0), lexicalScore);

function categorizeApp(process, title = "") {
  const haystack = `${process} ${title}`.toLowerCase();
  if (/code|cursor|devenv|idea/i.test(haystack)) return "coding";
  if (/chrome|firefox|msedge/i.test(haystack)) return "browser";
  if (/youtube|steam|tiktok/i.test(haystack)) return "entertainment";
  return "other";
}
assert.equal(categorizeApp("Code.exe", "app.ts"), "coding");
assert.equal(categorizeApp("chrome.exe", "docs"), "browser");
assert.equal(categorizeApp("steam.exe", "game"), "entertainment");

function parseEditorContext(title) {
  const match = title.match(/^(?:\[[^\]]+\]\s*)?(.+?)\s*[-—–]\s*(.+?)$/);
  if (!match) return { file: title };
  return { file: match[1].trim(), repo: match[2].trim() };
}
const editor = parseEditorContext("ChatPanel.tsx — desktop-character");
assert.equal(editor.file, "ChatPanel.tsx");
assert.equal(editor.repo, "desktop-character");

function summarizeWorkingMemory(entries) {
  const distractionCounts = new Map();
  for (const entry of entries) {
    if (entry.kind === "distraction" && entry.app) {
      distractionCounts.set(entry.app, (distractionCounts.get(entry.app) ?? 0) + 1);
    }
  }
  const distractionApps = [...distractionCounts.entries()]
    .map(([app, count]) => ({ app, count }))
    .sort((left, right) => right.count - left.count);
  return {
    windowSwitchCount: entries.filter((entry) => entry.kind === "window_switch").length,
    distractionApps,
    topDistraction: distractionApps[0],
  };
}
const wm = summarizeWorkingMemory([
  { kind: "window_switch", app: "Code.exe" },
  { kind: "distraction", app: "chrome.exe" },
  { kind: "distraction", app: "chrome.exe" },
]);
assert.equal(wm.windowSwitchCount, 1);
assert.equal(wm.topDistraction.app, "chrome.exe");
assert.equal(wm.topDistraction.count, 2);

function passesRelevanceFloor(recall, lexical, floor = 0.12) {
  return recall >= floor || lexical >= 0.5;
}
assert.equal(passesRelevanceFloor(0.05, 0), false);
assert.equal(passesRelevanceFloor(0.05, 0.6), true);
assert.equal(passesRelevanceFloor(0.2, 0), true);

function renderIdleTemplate(text, vars) {
  return text
    .replace(/\{openLoop\}/g, vars.openLoop ?? "хвост")
    .replace(/\{appName\}/g, vars.appName ?? "окно");
}
assert.equal(
  renderIdleTemplate("Если {openLoop} ждёт", { openLoop: "рефакторинг" }),
  "Если рефакторинг ждёт",
);

const regressionDir = path.join(process.cwd(), "tests", "unit");
if (fs.existsSync(regressionDir)) {
  for (const file of fs
    .readdirSync(regressionDir)
    .filter((name) => name.endsWith(".json"))) {
    const payload = JSON.parse(
      fs.readFileSync(path.join(regressionDir, file), "utf8"),
    );
    assert.ok(payload.name, `${file} must include name`);
    assert.ok(payload.cases?.length, `${file} must include cases`);
  }
}

console.log("unit tests passed");
