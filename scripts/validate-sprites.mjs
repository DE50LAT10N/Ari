import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const alphaDir = join(root, "public/characters/ari/alpha");

const emotionFiles = {
  neutral: "neutral.png",
  happy: "happy.png",
  amused: "amused.png",
  annoyed: "annoyed.png",
  curious: "curious.png",
  empathetic: "empathetic.png",
  blush: "blush.png",
  bored: "bored.png",
  calm: "calm smile.png",
  surprised: "surprised.png",
  sad: "sad.png",
  sleepy: "sleepy.png",
  excited: "excited.png",
  pensive: "pensive.png",
  worried: "worried.png",
  proud: "proud.png",
  shy: "shy.png",
  determined: "determined.png",
};

const stateFiles = {
  idle: "idle.png",
  speaking: "speaking.png",
};

const MIN_BYTES = 8_000;
const errors = [];
const warnings = [];

function fileHash(path) {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}

for (const [emotion, file] of Object.entries(emotionFiles)) {
  const path = join(alphaDir, file);
  if (!existsSync(path)) {
    errors.push(`missing ${emotion}: ${file}`);
    continue;
  }
  const size = readFileSync(path).length;
  if (size < MIN_BYTES) {
    errors.push(`placeholder ${emotion}: ${file} (${size} bytes)`);
  }
}

for (const [state, file] of Object.entries(stateFiles)) {
  const path = join(alphaDir, file);
  if (!existsSync(path)) {
    errors.push(`missing state ${state}: ${file}`);
    continue;
  }
  const size = readFileSync(path).length;
  if (size < MIN_BYTES) {
    errors.push(`placeholder state ${state}: ${file} (${size} bytes)`);
  }
}

const typoPath = join(alphaDir, "determmined.png");
if (existsSync(typoPath)) {
  warnings.push("orphan typo file determmined.png — delete or rename to determined.png");
}

const hashToNames = new Map();
for (const file of readdirSync(alphaDir).filter((name) => name.endsWith(".png"))) {
  const path = join(alphaDir, file);
  const hash = fileHash(path);
  const group = hashToNames.get(hash) ?? [];
  group.push(file);
  hashToNames.set(hash, group);
}

for (const [hash, names] of hashToNames) {
  if (names.length < 2) continue;
  const emotionNames = names.filter((name) =>
    Object.values(emotionFiles).includes(name),
  );
  if (emotionNames.length >= 2) {
    warnings.push(
      `duplicate emotion sprites (${hash.slice(0, 8)}…): ${emotionNames.join(", ")}`,
    );
  }
  const stateNames = names.filter((name) =>
    Object.values(stateFiles).includes(name),
  );
  if (stateNames.length >= 2) {
    warnings.push(
      `duplicate state sprites (${hash.slice(0, 8)}…): ${stateNames.join(", ")}`,
    );
  }
}

if (warnings.length) {
  console.warn("sprite warnings:");
  for (const warning of warnings) console.warn(`  - ${warning}`);
}

if (errors.length) {
  console.error("sprite validation failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `sprite validation ok (${Object.keys(emotionFiles).length} emotions + ${Object.keys(stateFiles).length} states)`,
);
