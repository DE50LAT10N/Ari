import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === "win32";
const tauriBin = join(
  root,
  "node_modules",
  ".bin",
  isWindows ? "tauri.cmd" : "tauri",
);

function readWindowsCommitFromCounters() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Get-Counter '\\Memory\\Committed Bytes','\\Memory\\Commit Limit' |",
    "  Select-Object -ExpandProperty CounterSamples |",
    "  Select-Object Path,CookedValue |",
    "  ConvertTo-Json -Compress",
  ].join("\n");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const samples = JSON.parse(output);
  const rows = Array.isArray(samples) ? samples : [samples];
  const committed = rows.find((row) =>
    String(row.Path ?? "").toLowerCase().includes("committed bytes"),
  );
  const limit = rows.find((row) =>
    String(row.Path ?? "").toLowerCase().includes("commit limit"),
  );
  const committedBytes = Number(committed?.CookedValue);
  const limitBytes = Number(limit?.CookedValue);
  if (!Number.isFinite(committedBytes) || !Number.isFinite(limitBytes)) {
    throw new Error("commit counters were unavailable");
  }
  return {
    Source: "counters",
    FreeVirtualMemoryKB: Math.max(0, Math.floor((limitBytes - committedBytes) / 1024)),
    TotalVirtualMemoryKB: Math.floor(limitBytes / 1024),
  };
}

function readWindowsMemoryFromWmic() {
  const output = execFileSync(
    "wmic.exe",
    [
      "OS",
      "get",
      "FreeVirtualMemory,TotalVirtualMemorySize,FreePhysicalMemory,TotalVisibleMemorySize",
      "/format:list",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const memory = {};
  for (const line of output.split(/\r?\n/)) {
    const [key, value] = line.split("=");
    if (key && value) {
      memory[key.trim()] = Number(value.trim());
    }
  }
  if (!Number.isFinite(memory.FreeVirtualMemory)) {
    throw new Error("wmic memory data was unavailable");
  }
  return {
    Source: "wmic",
    FreeVirtualMemoryKB: memory.FreeVirtualMemory,
    TotalVirtualMemoryKB: memory.TotalVirtualMemorySize,
    FreePhysicalMemoryKB: memory.FreePhysicalMemory,
    TotalPhysicalMemoryKB: memory.TotalVisibleMemorySize,
  };
}

function readWindowsMemory() {
  try {
    return readWindowsCommitFromCounters();
  } catch {
    return readWindowsMemoryFromWmic();
  }
}

function formatGb(kb) {
  return `${(Number(kb) / 1024 / 1024).toFixed(1)} GB`;
}

function runBuildPreflight() {
  if (!isWindows || process.env.ARI_SKIP_BUILD_MEMORY_CHECK === "1") {
    return;
  }
  let memory;
  try {
    memory = readWindowsMemory();
  } catch (error) {
    console.warn(`[tauri-preflight] Could not read Windows memory state: ${error}`);
    return;
  }

  const freeVirtualKb = Number(memory.FreeVirtualMemoryKB ?? 0);
  const minFreeVirtualKb = 4 * 1024 * 1024;
  if (freeVirtualKb >= minFreeVirtualKb) {
    return;
  }

  console.error(
    [
      "Tauri/Rust build needs more free Windows virtual memory (commit).",
      `Free virtual memory: ${formatGb(freeVirtualKb)}.`,
      `Commit limit: ${formatGb(memory.TotalVirtualMemoryKB ?? 0)}.`,
      "",
      "Close heavy apps or reboot, then increase Windows pagefile if needed:",
      "System Properties -> Performance -> Advanced -> Virtual memory -> System managed",
      "or set a manual size around 32768 MB.",
      "",
      "To bypass this guard anyway, run with ARI_SKIP_BUILD_MEMORY_CHECK=1.",
    ].join("\n"),
  );
  process.exit(1);
}

if (!existsSync(tauriBin)) {
  console.error(`Tauri CLI binary not found: ${tauriBin}`);
  process.exit(1);
}

if (args[0] === "build") {
  runBuildPreflight();
}

const env = {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "1",
  CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "0",
  RUST_BACKTRACE: process.env.RUST_BACKTRACE ?? "0",
};

const result = spawnSync(tauriBin, args, {
  cwd: root,
  env,
  stdio: "inherit",
  shell: isWindows,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
