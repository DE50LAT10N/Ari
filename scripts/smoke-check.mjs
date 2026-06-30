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

console.log(`Smoke: versions aligned at ${packageVersion}`);

function run(command, args) {
  if (command === "npm" && process.env.npm_execpath) {
    const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) {
      console.error(result.error.message);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
    return;
  }
  if (command === "npm" && args[0] === "run" && args[1]) {
    const result = spawnSync(`npm run ${args[1]}`, {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    if (result.error) {
      console.error(result.error.message);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
    return;
  }
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "build"]);
run("npm", ["run", "test:unit"]);

console.log("Smoke check passed.");
