import { useEffect, useState } from "react";
import {
  formatBinderFileAge,
  getActiveProjectBinder,
  loadProjectBinders,
  listRecentProjectFiles,
  pinProjectFile,
  removeProjectBinder,
  setActiveProjectBinder,
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
  const [error, setError] = useState("");

  const refresh = () => {
    const loaded = loadProjectBinders();
    const current = getActiveProjectBinder();
    setProjects(loaded);
    setActive(current);
    if (current) {
      void listRecentProjectFiles(current, 20).then(setFiles).catch(() => setFiles([]));
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

  return (
    <div className="about-panel">
      <div className="about-title-row">
        <button type="button" onClick={onBack} aria-label="Назад">←</button>
        <strong>Проекты</strong>
      </div>
      <p className="settings-hint">
        Папки проектов, к которым я могу заглянуть — только чтение, с твоего разрешения.
      </p>

      <form className="settings-form" onSubmit={handleSave}>
        <label className="settings-field">
          <span>Название</span>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="settings-field">
          <span>Абсолютный путь</span>
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
          <strong>Недавние файлы — {active.name}</strong>
          <section className="memory-list">
            {files.map((file) => (
              <div className="memory-inbox-item" key={file.relativePath}>
                <strong>{file.relativePath}</strong>
                <p>
                  {formatBinderFileAge(file.modifiedAt)} · {file.sizeBytes} B
                </p>
                <button
                  type="button"
                  onClick={() => pinProjectFile(active.id, file.relativePath)}
                >
                  Закрепить
                </button>
              </div>
            ))}
            {!files.length && <p className="settings-hint">Файлы не найдены.</p>}
          </section>
        </>
      )}
    </div>
  );
}
