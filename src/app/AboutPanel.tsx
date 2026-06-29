import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { logError } from "../platform/logger";

type AboutPanelProps = {
  onBack: () => void;
};

export function AboutPanel({ onBack }: AboutPanelProps) {
  const [version, setVersion] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");

  useEffect(() => {
    void Promise.all([getVersion(), getTauriVersion()])
      .then(([appVersion, runtimeVersion]) => {
        setVersion(appVersion);
        setTauriVersion(runtimeVersion);
      })
      .catch((error: unknown) => {
        logError("Failed to read application version", error);
      });
  }, []);

  return (
    <div className="about-panel">
      <div className="about-title-row">
        <button type="button" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <strong>О приложении</strong>
      </div>

      <img
        className="about-icon"
        src="/app-icon.png"
        alt="Ari"
      />

      <div className="about-copy">
        <strong>Ari</strong>
        <span>Версия {version}</span>
        <p>
          Персонаж на рабочем столе: живёт рядом, говорит, реагирует, помнит.
          Модель — Ollama локально или GigaChat в облаке.
        </p>
      </div>

      <div className="about-meta">
        <span>Runtime</span>
        <strong>Tauri {tauriVersion || "2"}</strong>
        <span>Данные</span>
        <strong>Память хранится локально</strong>
        <span>Облачные API</span>
        <strong>Только в режиме GigaChat</strong>
      </div>
    </div>
  );
}
