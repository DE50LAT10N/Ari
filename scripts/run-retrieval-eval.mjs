import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readVersion(filePath, pattern) {
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Version not found in ${filePath}`);
  }
  return match[1];
}

const packageVersion = readVersion(
  path.join(root, "package.json"),
  /"version"\s*:\s*"([^"]+)"/,
);
const tauriVersion = readVersion(
  path.join(root, "src-tauri", "tauri.conf.json"),
  /"version"\s*:\s*"([^"]+)"/,
);
const cargoVersion = readVersion(
  path.join(root, "src-tauri", "Cargo.toml"),
  /^version\s*=\s*"([^"]+)"/m,
);

if (
  packageVersion !== tauriVersion ||
  packageVersion !== cargoVersion
) {
  console.error("Version mismatch:");
  console.error(`  package.json: ${packageVersion}`);
  console.error(`  tauri.conf.json: ${tauriVersion}`);
  console.error(`  Cargo.toml: ${cargoVersion}`);
  process.exit(1);
}

console.log(`Version check OK: ${packageVersion}`);

const live = process.argv.includes("--live");
if (live) {
  console.log("Live retrieval eval is not wired in CI — run offline suite only.");
}

const vitest = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "vitest", "vitest.mjs"),
    "run",
    "tests/retrievalRecall.test.ts",
  ],
  { cwd: root, stdio: "inherit", shell: false },
);

process.exit(vitest.status ?? 1);
