import { invoke } from "@tauri-apps/api/core";

export async function startOllamaProcess(): Promise<void> {
  await invoke("start_ollama");
}

export async function stopOllamaAndExit(): Promise<void> {
  await invoke("stop_ollama_and_exit");
}

export async function exitAri(): Promise<void> {
  await invoke("exit_ari");
}
