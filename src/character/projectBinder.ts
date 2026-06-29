import {
  listBinderFiles,
  readBinderFile,
  type BinderFileEntry,
} from "../platform/projectCompanion";

export type ProjectBinder = {
  id: string;
  name: string;
  rootPath: string;
  allowedExtensions: string[];
  pinnedPaths: string[];
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "desktop-character.project-binder.v1";
const ACTIVE_KEY = "desktop-character.project-binder.active.v1";

const DEFAULT_EXTENSIONS = [
  "md",
  "txt",
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "rs",
  "toml",
  "css",
  "html",
  "yaml",
  "yml",
];

function notify(): void {
  window.dispatchEvent(new Event("ari-project-binder-changed"));
}

function loadAll(): ProjectBinder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(projects: ProjectBinder[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, 20)));
  notify();
}

export function loadProjectBinders(): ProjectBinder[] {
  return loadAll();
}

export function getActiveProjectBinder(): ProjectBinder | null {
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (!activeId) return loadAll()[0] ?? null;
  return loadAll().find((project) => project.id === activeId) ?? null;
}

export function setActiveProjectBinder(id: string): ProjectBinder | null {
  const project = loadAll().find((entry) => entry.id === id) ?? null;
  if (!project) return null;
  localStorage.setItem(ACTIVE_KEY, id);
  notify();
  return project;
}

export function upsertProjectBinder(input: {
  id?: string;
  name: string;
  rootPath: string;
  allowedExtensions?: string[];
}): ProjectBinder {
  const projects = loadAll();
  const now = Date.now();
  const existingIndex = input.id
    ? projects.findIndex((project) => project.id === input.id)
    : -1;
  const project: ProjectBinder = {
    id:
      existingIndex >= 0
        ? projects[existingIndex].id
        : (input.id ?? crypto.randomUUID()),
    name: input.name.trim().slice(0, 120) || "Проект",
    rootPath: input.rootPath.trim(),
    allowedExtensions: input.allowedExtensions ?? DEFAULT_EXTENSIONS,
    pinnedPaths:
      existingIndex >= 0 ? projects[existingIndex].pinnedPaths : [],
    createdAt: existingIndex >= 0 ? projects[existingIndex].createdAt : now,
    updatedAt: now,
  };
  if (existingIndex >= 0) projects[existingIndex] = project;
  else projects.unshift(project);
  saveAll(projects);
  if (!localStorage.getItem(ACTIVE_KEY)) {
    localStorage.setItem(ACTIVE_KEY, project.id);
  }
  return project;
}

export function pinProjectFile(projectId: string, relativePath: string): void {
  const projects = loadAll();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index < 0) return;
  const normalized = relativePath.trim().replace(/\\/g, "/");
  if (!normalized || projects[index].pinnedPaths.includes(normalized)) return;
  projects[index] = {
    ...projects[index],
    pinnedPaths: [normalized, ...projects[index].pinnedPaths].slice(0, 30),
    updatedAt: Date.now(),
  };
  saveAll(projects);
}

export function removeProjectBinder(id: string): void {
  const projects = loadAll().filter((project) => project.id !== id);
  saveAll(projects);
  if (localStorage.getItem(ACTIVE_KEY) === id) {
    if (projects[0]) localStorage.setItem(ACTIVE_KEY, projects[0].id);
    else localStorage.removeItem(ACTIVE_KEY);
  }
}

export async function listRecentProjectFiles(
  project?: ProjectBinder | null,
  limit = 20,
): Promise<BinderFileEntry[]> {
  const active = project ?? getActiveProjectBinder();
  if (!active?.rootPath) return [];
  return listBinderFiles(active.rootPath, {
    allowedExtensions: active.allowedExtensions,
    limit,
  });
}

export async function readProjectFile(
  relativePath: string,
  project?: ProjectBinder | null,
): Promise<string> {
  const active = project ?? getActiveProjectBinder();
  if (!active?.rootPath) {
    throw new Error("Активный проект не выбран.");
  }
  return readBinderFile(
    active.rootPath,
    relativePath,
    active.allowedExtensions,
  );
}

export function formatBinderFileAge(modifiedAt: number): string {
  if (!modifiedAt) return "—";
  const deltaMs = Date.now() - modifiedAt;
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  return `${days} дн назад`;
}

export function describePinnedProjectContext(
  project?: ProjectBinder | null,
): string {
  const active = project ?? getActiveProjectBinder();
  if (!active?.pinnedPaths?.length) {
    return "";
  }
  return [
    `Активный проект: ${active.name} (${active.rootPath}).`,
    "Закреплённые файлы проекта (лёгкий фон, не цитируй без нужды):",
    ...active.pinnedPaths.slice(0, 8).map((path) => `- ${path}`),
  ].join("\n");
}
