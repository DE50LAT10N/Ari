import { invoke } from "@tauri-apps/api/core";

export function getUserIdleSeconds(): Promise<number> {
  return invoke<number>("get_user_idle_seconds");
}
