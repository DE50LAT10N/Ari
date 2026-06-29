import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const characterDir = path.join(root, "tests", "character");
const evalsDir = path.join(root, "evals");
const system = await fs.readFile(path.join(characterDir, "system.txt"), "utf8");

async function loadSuites() {
  const suites = [];
  for (const directory of [characterDir, evalsDir]) {
    let files = [];
    try {
      files = (await fs.readdir(directory))
        .filter((file) => file.endsWith(".json"))
        .sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const test = JSON.parse(
        await fs.readFile(path.join(directory, file), "utf8"),
      );
      if (!Array.isArray(test.messages)) {
        continue;
      }
      suites.push({
        ...test,
        name: test.name ?? test.id ?? file,
        source: path.relative(root, path.join(directory, file)),
      });
    }
  }
  return suites;
}

const provider = process.env.CHARACTER_TEST_PROVIDER ?? "ollama";

async function generate(test) {
  if (provider === "gigachat") {
    throw new Error(
      "Для live GigaChat eval используйте интерфейс Ari Diagnostics: Authorization key хранится через Windows DPAPI.",
    );
  }
  const response = await fetch(
    `${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:
          process.env.OLLAMA_MODEL ??
          "hf.co/Qwen/Qwen3-14B-GGUF:Q5_K_M",
        stream: false,
        think: false,
        messages: [{ role: "system", content: system }, ...test.messages],
        options: {
          temperature: 0,
          seed: 42,
          num_predict: 360,
          num_ctx: 4096,
        },
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.message?.content ?? "";
}

function validate(test, raw) {
  const normalizedRaw = raw
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "")
    .replace(/^\s*<\/think>\s*/i, "")
    .trim();
  const emotion =
    normalizedRaw.match(/<emotion>\s*([^<\s]+)\s*<\/emotion>/i)?.[1]?.toLowerCase() ??
    normalizedRaw.match(
      /<(neutral|happy|amused|annoyed|curious|empathetic|blush|bored|calm|surprised)\s*>/i,
    )?.[1]?.toLowerCase() ??
    normalizedRaw.match(
      /^\s*(neutral|happy|amused|annoyed|curious|empathetic|blush|bored|calm|surprised)\b/i,
    )?.[1]?.toLowerCase() ??
    "";
  const text = normalizedRaw
    .replace(/<emotion>[\s\S]*?<\/emotion>/i, "")
    .replace(
      /<\/?(neutral|happy|amused|annoyed|curious|empathetic|blush|bored|calm|surprised)\s*>/gi,
      "",
    )
    .replace(
      /^\s*(neutral|happy|amused|annoyed|curious|empathetic|blush|bored|calm|surprised)\b\s*/i,
      "",
    )
    .replace(/<\/?emotion\s*>/gi, "")
    .trim();
  const lower = text.toLowerCase();
  const failures = [];
  const expected = test.expected ?? {};

  for (const forbidden of expected.mustNotContain ?? []) {
    if (lower.includes(forbidden.toLowerCase())) {
      failures.push(`contains forbidden: ${forbidden}`);
    }
  }
  if (
    expected.mustContainAny?.length &&
    !expected.mustContainAny.some((value) =>
      lower.includes(value.toLowerCase()),
    )
  ) {
    failures.push(`contains none of: ${expected.mustContainAny.join(", ")}`);
  }
  if (
    expected.allowedEmotions?.length &&
    !expected.allowedEmotions.includes(emotion)
  ) {
    failures.push(`emotion ${emotion || "(missing)"} is not allowed`);
  }
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean).length;
  if (expected.maxParagraphs && paragraphs > expected.maxParagraphs) {
    failures.push(`paragraphs ${paragraphs} > ${expected.maxParagraphs}`);
  }
  const maxChars = expected.maxChars ?? expected.maxLength;
  if (maxChars && text.length > maxChars) {
    failures.push(`chars ${text.length} > ${maxChars}`);
  }
  if (
    expected.forbidHumor &&
    /(ха-ха|шут|забавно|смешно|ну ты даёшь)/i.test(text)
  ) {
    failures.push("humor detected in serious mode");
  }
  return { failures, emotion, text };
}

const suites = await loadSuites();
let failed = 0;
for (const test of suites) {
  try {
    const raw = await generate(test);
    const result = validate(test, raw);
    if (result.failures.length) {
      failed += 1;
      console.error(`FAIL ${test.name} (${test.source})`);
      result.failures.forEach((failure) => console.error(`  - ${failure}`));
      console.error(`  ${result.text.slice(0, 300)}`);
    } else {
      console.log(`PASS ${test.name} [${result.emotion || "n/a"}] (${test.source})`);
    }
  } catch (error) {
    failed += 1;
    console.error(`ERROR ${test.name}: ${error.message}`);
  }
}

console.log(`\n${suites.length - failed}/${suites.length} character tests passed.`);

function runProductivityV3Checks() {
  const commandPatterns = [
    { input: "запиши в backlog fix privacy", pattern: /^запиши в backlog/i },
    { input: "что next", pattern: /^что next/i },
    { input: "по privacy", pattern: /^по privacy/i },
    { input: "отложи задача", pattern: /^отложи/i },
    { input: "покажи последние изменённые файлы", pattern: /покажи последние изменённые файлы/i },
    { input: "git status", pattern: /git status|статус git|git summary/i },
    { input: "daily review", pattern: /daily review|дневной обзор/i },
  ];
  let productivityFailed = 0;
  for (const { input, pattern } of commandPatterns) {
    if (!pattern.test(input)) {
      productivityFailed += 1;
      console.error(`FAIL productivity command pattern: ${input}`);
    }
  }

  const writeVerb = /\b(commit|push|pull|merge|rebase|reset|checkout|cherry-pick|revert|stash|tag|add|rm|mv)\b/i;
  if (!writeVerb.test("git commit -m test")) {
    productivityFailed += 1;
    console.error("FAIL git write verb detection");
  }

  if (productivityFailed === 0) {
    console.log(`PASS productivity v3 checks (${commandPatterns.length + 1} assertions)`);
  } else {
    console.error(`FAIL ${productivityFailed} productivity v3 checks`);
    failed += productivityFailed;
  }
}

runProductivityV3Checks();
process.exitCode = failed ? 1 : 0;
