import { useEffect, useState } from "react";
import {
  formatBinderFileAge,
  getActiveProjectBinder,
  loadProjectBinders,
  listRecentProjectFiles,
  normalizeProjectRelativePath,
  pinProjectFile,
  removeProjectBinder,
  setActiveProjectBinder,
  unpinProjectFile,
  upsertProjectBinder,
  type ProjectBinder,
} from "../character/projectBinder";
import type { BinderFileEntry } from "../platform/projectCompanion";

type ProjectBinderPanelProps = {
  onBack: () => void;
};

export function ProjectBinderPanel({ onBack }: ProjectBinderPanelProps) {
  const [projects, setProjects] = useState<ProjectBinder[]>([]);
  const [active, setActive] = useState<ProjectBinder | null>(null);
  const [files, setFiles] = useState<BinderFileEntry[]>([]);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [filePath, setFilePath] = useState("");
  const [error, setError] = useState("");

  const refresh = () => {
    const loaded = loadProjectBinders();
    const current = getActiveProjectBinder();
    setProjects(loaded);
    setActive(current);
    if (current) {
      void listRecentProjectFiles(current, 50).then(setFiles).catch(() => setFiles([]));
    } else {
      setFiles([]);
    }
  };

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener("ari-project-binder-changed", handler);
    return () => window.removeEventListener("ari-project-binder-changed", handler);
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!rootPath.trim()) {
      setError("Укажи абсолютный путь к папке проекта.");
      return;
    }
    try {
      upsertProjectBinder({
        name: name.trim() || "Проект",
        rootPath: rootPath.trim(),
      });
      setName("");
      setRootPath("");
      refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }

  function handlePinFile(event: React.FormEvent) {
    event.preventDefault();
    if (!active) return;
    setError("");
    const normalized = normalizeProjectRelativePath(filePath);
    if (!normalized) {
      setError("Укажи путь к файлу относительно корня проекта.");
      return;
    }
    pinProjectFile(active.id, normalized);
    setFilePath("");
    refresh();
  }

  return (
    <div className="about-panel">
      <div className="about-title-row">
        <button type="button" onClick={onBack} aria-label="Назад">←</button>
        <strong>Проекты</strong>
      </div>
      <p className="settings-hint">
        Добавь <strong>корневую папку</strong> проекта (не отдельный файл). После добавления
        нажми «Сделать активным». Ari увидит открытый в редакторе файл, если его имя совпадает
        с файлом в проекте, или если ты закрепил его ниже.
      </p>
      <p className="settings-hint">
        Пример пути: <code>C:\projects\my-app</code>. Поддерживаются ts, tsx, js, json, md и др.
      </p>

      <form className="settings-form" onSubmit={handleSave}>
        <label className="settings-field">
          <span>Название</span>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="settings-field">
          <span>Абсолютный путь к папке</span>
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.currentTarget.value)}
            placeholder="C:\projects\my-app"
          />
        </label>
        {error && <p className="settings-error">{error}</p>}
        <button type="submit">Добавить / обновить проект</button>
      </form>

      <section className="memory-list">
        {projects.map((project) => (
          <div className="memory-inbox-item" key={project.id}>
            <strong>{project.name}</strong>
            <p>{project.rootPath}</p>
            <div className="memory-inbox-actions">
              <button
                type="button"
                onClick={() => {
                  setActiveProjectBinder(project.id);
                  refresh();
                }}
              >
                {active?.id === project.id ? "Активен" : "Сделать активным"}
              </button>
              <button type="button" onClick={() => removeProjectBinder(project.id)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </section>

      {active && (
        <>
          <strong>Закреплённые файлы — {active.name}</strong>
          <p className="settings-hint">
            Закреплённые файлы Ari читает в первую очередь и упоминает в контексте.
          </p>
          <form className="settings-form" onSubmit={handlePinFile}>
            <label className="settings-field">
              <span>Путь к файлу в проекте</span>
              <input
                value={filePath}
                onChange={(e) => setFilePath(e.currentTarget.value)}
                placeholder="src/app/ChatPanel.tsx"
              />
            </label>
            <button type="submit">Закрепить файл</button>
          </form>
          <section className="memory-list">
            {active.pinnedPaths.map((path) => (
              <div className="memory-inbox-item" key={path}>
                <strong>{path}</strong>
                <button
                  type="button"
                  onClick={() => {
                    unpinProjectFile(active.id, path);
                    refresh();
                  }}
                >
                  Открепить
                </button>
              </div>
            ))}
            {!active.pinnedPaths.length && (
              <p className="settings-hint">Пока нет закреплённых файлов.</p>
            )}
          </section>

          <div className="about-title-row">
            <strong>Недавние файлы</strong>
            <button type="button" onClick={() => refresh()}>
              Обновить
            </button>
          </div>
          <section className="memory-list">
            {files.map((file) => (
              <div className="memory-inbox-item" key={file.relativePath}>
                <strong>{file.relativePath}</strong>
                <p>
                  {formatBinderFileAge(file.modifiedAt)} · {file.sizeBytes} B
                </p>
                <button
                  type="button"
                  onClick={() => {
                    pinProjectFile(active.id, file.relativePath);
                    refresh();
                  }}
                  disabled={active.pinnedPaths.includes(file.relativePath)}
                >
                  {active.pinnedPaths.includes(file.relativePath) ? "Закреплён" : "Закрепить"}
                </button>
              </div>
            ))}
            {!files.length && (
              <p className="settings-hint">
                Файлы не найдены. Проверь путь к папке и расширения (ts, tsx, js, md…).
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
