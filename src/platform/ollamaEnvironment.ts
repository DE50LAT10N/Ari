import { invoke } from "@tauri-apps/api/core";

export async function restartOllama(modelsDir?: string): Promise<string> {
  const trimmed = modelsDir?.trim();
  return invoke<string>("restart_ollama", {
    modelsDir: trimmed ? trimmed : null,
  });
}
