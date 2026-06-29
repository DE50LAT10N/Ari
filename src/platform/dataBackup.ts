import JSZip from "jszip";
import { loadSettings, saveSettings, defaultSettings } from "../settings/appSettings";
import { loadChatHistory, saveChatHistory } from "../chat/chatHistory";
import {
  loadUserMemory,
  loadUserMemorySummaries,
  clearUserMemory,
  addUserMemoryFacts,
} from "../memory/userMemory";
import {
  loadEpisodes,
  loadOpenLoops,
  clearEpisodicMemory,
  addEpisodes,
  addOpenLoops,
} from "../memory/episodicMemory";
import { loadRelationship } from "../character/relationship";
import { loadMood, saveMood, type CharacterMood } from "../character/mood";
import { loadAriSelfMemory } from "../character/selfMemory";
import { loadRagChunks, clearRagChunks } from "../rag/ragStore";
import { loadPreferenceRules, savePreferenceRules } from "../memory/userPreferenceRules";
import { loadFocusSessions, importFocusSessions } from "../character/focusSession";
import { loadTasks, invalidateTaskCache } from "../tasks/taskStore";
import { loadProjectBinders } from "../character/projectBinder";
import { loadPomodoroState } from "../character/pomodoro";
import { APP_VERSION } from "./appVersion";
import type { UserMemorySummary } from "../memory/userMemory";
import { importMemorySummaries } from "../memory/userMemory";

export const BACKUP_SCHEMA_VERSION = 1;

export type BackupManifest = {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  includesEmbeddings: boolean;
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportAriData(
  includeEmbeddings = false,
): Promise<void> {
  const settings = loadSettings();
  const { gigaChatScope: _scope, ...settingsWithoutSecrets } = settings;

  const manifest: BackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    includesEmbeddings: includeEmbeddings,
  };

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("settings.json", JSON.stringify(settingsWithoutSecrets, null, 2));
  zip.file("chat-history.json", JSON.stringify(loadChatHistory(), null, 2));

  const facts = await loadUserMemory();
  const summaries = await loadUserMemorySummaries();
  zip.file(
    "long-term-memory.json",
    JSON.stringify({ facts, summaries }, null, 2),
  );

  zip.file("episodic-memory.json", JSON.stringify(await loadEpisodes(), null, 2));
  zip.file("tasks.json", JSON.stringify(loadTasks({ includeDone: true }), null, 2));
  zip.file(
    "unfinished-threads.json",
    JSON.stringify(await loadOpenLoops(true), null, 2),
  );
  zip.file("relationship.json", JSON.stringify(loadRelationship(), null, 2));
  zip.file("mood.json", JSON.stringify(loadMood(), null, 2));
  zip.file("feedback.json", JSON.stringify(loadAriSelfMemory(), null, 2));
  zip.file(
    "preference-rules.json",
    JSON.stringify(loadPreferenceRules(), null, 2),
  );
  zip.file(
    "focus-sessions.json",
    JSON.stringify(loadFocusSessions(), null, 2),
  );
  zip.file("backlog.json", JSON.stringify([], null, 2));
  zip.file("inbox.json", JSON.stringify([], null, 2));
  zip.file(
    "project-binders.json",
    JSON.stringify(
      {
        projects: loadProjectBinders(),
        activeId: localStorage.getItem("desktop-character.project-binder.active.v1"),
      },
      null,
      2,
    ),
  );
  zip.file("pomodoro.json", JSON.stringify(loadPomodoroState(), null, 2));

  const ragChunks = await loadRagChunks();
  zip.file(
    "rag-metadata.json",
    JSON.stringify(
      ragChunks.map(({ id, source, text, createdAt }) => ({
        id,
        source,
        text,
        createdAt,
      })),
      null,
      2,
    ),
  );

  if (includeEmbeddings) {
    zip.file("rag-embeddings.json", JSON.stringify(ragChunks, null, 2));
  }

  const date = new Date().toISOString().slice(0, 10);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `ari-backup-${date}.zip`);
}

export async function importAriData(
  file: File,
  options: { reindexRag?: boolean } = {},
): Promise<string[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const warnings: string[] = [];

  const manifestRaw = await zip.file("manifest.json")?.async("string");
  if (manifestRaw) {
    const manifest = JSON.parse(manifestRaw) as BackupManifest;
    if (manifest.schemaVersion > BACKUP_SCHEMA_VERSION) {
      warnings.push(
        "Резервная копия создана более новой версией Ari. Импорт может быть неполным.",
      );
    }
  }

  const settingsRaw = await zip.file("settings.json")?.async("string");
  if (settingsRaw) {
    saveSettings({ ...defaultSettings, ...JSON.parse(settingsRaw) });
  }

  const historyRaw = await zip.file("chat-history.json")?.async("string");
  if (historyRaw) {
    saveChatHistory(JSON.parse(historyRaw));
  }

  const memoryRaw = await zip.file("long-term-memory.json")?.async("string");
  if (memoryRaw) {
    await clearUserMemory();
    const { facts, summaries } = JSON.parse(memoryRaw) as {
      facts: Array<{ text: string }>;
      summaries: unknown[];
    };
    if (facts?.length) {
      await addUserMemoryFacts(
        facts.map((f) => f.text),
        "manual",
      );
    }
    if (summaries?.length) {
      await importMemorySummaries(summaries as UserMemorySummary[]);
    }
  }

  const focusRaw = await zip.file("focus-sessions.json")?.async("string");
  if (focusRaw) {
    const sessions = JSON.parse(focusRaw) as ReturnType<typeof loadFocusSessions>;
    if (sessions.length) {
      importFocusSessions(sessions);
    }
  }

  const tasksRaw = await zip.file("tasks.json")?.async("string");
  const backlogRaw = await zip.file("backlog.json")?.async("string");
  const inboxRaw = await zip.file("inbox.json")?.async("string");
  const threadsRaw = await zip.file("unfinished-threads.json")?.async("string");

  if (tasksRaw) {
    localStorage.setItem("desktop-character.tasks.v1", tasksRaw);
    localStorage.setItem("desktop-character.tasks-migrated.v1", "1");
    invalidateTaskCache();
  }

  if (!tasksRaw && (backlogRaw || inboxRaw || threadsRaw)) {
    localStorage.removeItem("desktop-character.tasks-migrated.v1");
  }

  if (backlogRaw) {
    localStorage.setItem(
      "desktop-character.ari-backlog.v1",
      backlogRaw,
    );
  }

  if (inboxRaw) {
    localStorage.setItem("desktop-character.ari-inbox.v1", inboxRaw);
  }

  const binderRaw = await zip.file("project-binders.json")?.async("string");
  if (binderRaw) {
    const parsed = JSON.parse(binderRaw) as {
      projects?: unknown[];
      activeId?: string | null;
    };
    if (parsed.projects) {
      localStorage.setItem(
        "desktop-character.project-binder.v1",
        JSON.stringify(parsed.projects),
      );
    }
    if (parsed.activeId) {
      localStorage.setItem(
        "desktop-character.project-binder.active.v1",
        parsed.activeId,
      );
    }
  }

  const pomodoroRaw = await zip.file("pomodoro.json")?.async("string");
  if (pomodoroRaw) {
    localStorage.setItem("desktop-character.pomodoro.v1", pomodoroRaw);
  }

  const episodesRaw = await zip.file("episodic-memory.json")?.async("string");
  if (episodesRaw) {
    await clearEpisodicMemory();
    const episodes = JSON.parse(episodesRaw) as Array<{
      title: string;
      text: string;
    }>;
    if (episodes.length) await addEpisodes(episodes);
  }

  if (threadsRaw && !tasksRaw) {
    const loops = JSON.parse(threadsRaw) as Array<{
      text: string;
      dueAt?: number;
    }>;
    if (loops.length) await addOpenLoops(loops);
  }

  const relationshipRaw = await zip.file("relationship.json")?.async("string");
  if (relationshipRaw) {
    localStorage.setItem(
      "desktop-character.ari-relationship.v1",
      relationshipRaw,
    );
  }

  const moodRaw = await zip.file("mood.json")?.async("string");
  if (moodRaw) {
    saveMood(JSON.parse(moodRaw) as CharacterMood);
  }

  const feedbackRaw = await zip.file("feedback.json")?.async("string");
  if (feedbackRaw) {
    localStorage.setItem(
      "desktop-character.ari-self-memory.v1",
      feedbackRaw,
    );
  }

  const rulesRaw = await zip.file("preference-rules.json")?.async("string");
  if (rulesRaw) {
    savePreferenceRules(JSON.parse(rulesRaw));
  }

  const ragRaw = await zip.file("rag-metadata.json")?.async("string");
  const embeddingsRaw = await zip.file("rag-embeddings.json")?.async("string");
  if (embeddingsRaw && !options.reindexRag) {
    warnings.push(
      "RAG-векторы не импортированы. Включите reindex или добавьте файлы заново.",
    );
  } else if (options.reindexRag && ragRaw) {
    warnings.push(
      "Метаданные RAG импортированы. Запустите переиндексацию в настройках.",
    );
  }

  return warnings;
}

export async function resetOnlyMemory(): Promise<void> {
  await clearUserMemory();
  await clearEpisodicMemory();
}

export async function resetOnlyRag(): Promise<void> {
  await clearRagChunks();
}

export function resetRelationshipAndMood(): void {
  localStorage.removeItem("desktop-character.ari-relationship.v1");
  localStorage.removeItem("desktop-character.ari-mood.v1");
}

export async function resetAllLocalData(): Promise<void> {
  await resetOnlyMemory();
  await resetOnlyRag();
  resetRelationshipAndMood();
  saveChatHistory([]);
  saveSettings(defaultSettings);
  localStorage.removeItem("desktop-character.ari-self-memory.v1");
  localStorage.removeItem("desktop-character.user-preference-rules.v1");
  localStorage.removeItem("desktop-character.work-sessions.v1");
  localStorage.removeItem("desktop-character.tasks.v1");
  localStorage.removeItem("desktop-character.tasks-migrated.v1");
  localStorage.removeItem("desktop-character.ari-memory-inbox.v1");
}

export async function backupBeforeUpdate(): Promise<void> {
  await exportAriData(false);
}
