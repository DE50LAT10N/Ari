import { logError, logInfo } from "./logger";

export async function checkForAppUpdates(): Promise<void> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      return;
    }
    logInfo("Update available", { version: update.version });
    const { backupBeforeUpdate } = await import("./dataBackup");
    await backupBeforeUpdate();
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    logError("Updater check failed", error);
  }
}
