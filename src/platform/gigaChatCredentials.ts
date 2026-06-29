import { invoke } from "@tauri-apps/api/core";

export function saveGigaChatAuthKey(authKey: string): Promise<void> {
  return invoke("save_gigachat_auth_key", { authKey });
}

export function loadGigaChatAuthKey(): Promise<string | null> {
  return invoke<string | null>("load_gigachat_auth_key");
}

export function deleteGigaChatAuthKey(): Promise<void> {
  return invoke("delete_gigachat_auth_key");
}
