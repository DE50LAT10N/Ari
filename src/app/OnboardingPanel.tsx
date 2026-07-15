import { useState } from "react";
import type { AppSettings } from "../settings/appSettings";
import { checkOllamaStatus } from "../llm/localLlmClient";
import { checkGigaChatStatus, clearGigaChatTokenCache } from "../llm/gigaChatClient";
import { saveGigaChatAuthKey } from "../platform/gigaChatCredentials";
import { GigaChatModelPicker } from "./GigaChatModelPicker";
import { GIGA_CHAT_CHAT_MODELS, syncGigaChatModelSelection } from "../llm/gigaChatModels";

type ProviderCheckState = "idle" | "checking" | "ready" | "offline";

export function OnboardingPanel({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const [checkState, setCheckState] = useState<ProviderCheckState>("idle");
  const [checkMessage, setCheckMessage] = useState("");
  const [gigaChatKey, setGigaChatKey] = useState("");

  async function verifyProvider(): Promise<boolean> {
    setCheckState("checking");
    setCheckMessage("");

    try {
      if (settings.llmProvider === "gigachat" && gigaChatKey.trim()) {
        await saveGigaChatAuthKey(gigaChatKey.trim());
        clearGigaChatTokenCache();
        setGigaChatKey("");
      }

      const status =
        settings.llmProvider === "gigachat"
          ? await checkGigaChatStatus(settings)
          : await checkOllamaStatus(settings.ollamaBaseUrl);

      if (status.online) {
        setCheckState("ready");
        return true;
      }

      setCheckState("offline");
      setCheckMessage(
        settings.llmProvider === "gigachat"
          ? "GigaChat пока недоступен — вставь Authorization key ниже или в настройках."
          : "Ollama не отвечает — можно настроить позже.",
      );
      return false;
    } catch (error) {
      setCheckState("offline");
      setCheckMessage(
        error instanceof Error
          ? error.message
          : "Не удалось проверить подключение.",
      );
      return false;
    }
  }

  async function handleStart(force = false) {
    if (!force) {
      const ready = await verifyProvider();
      if (!ready) {
        return;
      }
    }
    onChange({ ...settings, onboardingCompleted: true });
  }

  return (
    <div className="onboarding-backdrop">
      <section className="onboarding-panel">
        <strong>Привет. Я Ari.</strong>
        <p>
          Я Ari — AI-персонаж на твоём рабочем столе. Могу говорить через Ollama
          или GigaChat. Память, зрение и инициатива — только с твоего согласия.
        </p>
        <label className="settings-field">
          <span>Режим модели</span>
          <select
            value={settings.llmProvider}
            onChange={(event) => {
              setCheckState("idle");
              setCheckMessage("");
              onChange({
                ...settings,
                llmProvider: event.currentTarget.value as AppSettings["llmProvider"],
              });
            }}
          >
            <option value="ollama">Локальная Ollama</option>
            <option value="gigachat">GigaChat API</option>
          </select>
        </label>
        {settings.llmProvider === "gigachat" && (
          <>
            <label className="settings-field">
              <span>Ключ авторизации GigaChat</span>
              <input
                type="password"
                value={gigaChatKey}
                placeholder="Base64 Authorization key"
                autoComplete="off"
                onChange={(event) => {
                  setCheckState("idle");
                  setCheckMessage("");
                  setGigaChatKey(event.currentTarget.value);
                }}
              />
              <small>
                Ключ из проекта GigaChat API. Сохраняется локально (DPAPI) при проверке.
              </small>
            </label>
            <label className="settings-field">
              <span>Модель чата</span>
              <GigaChatModelPicker
                value={settings.gigaChatModel}
                options={GIGA_CHAT_CHAT_MODELS}
                onChange={(gigaChatModel) =>
                  onChange(syncGigaChatModelSelection(settings, gigaChatModel))
                }
              />
            </label>
          </>
        )}
        <label className="settings-field">
          <span>Как тебя называть</span>
          <input
            value={settings.userName}
            onChange={(event) => onChange({ ...settings, userName: event.currentTarget.value })}
          />
        </label>
        <label className="settings-field">
          <span>Тон Ari</span>
          <select
            value={settings.ariTone}
            onChange={(event) =>
              onChange({ ...settings, ariTone: event.currentTarget.value as AppSettings["ariTone"] })
            }
          >
            <option value="balanced">Сбалансированный</option>
            <option value="softer">Мягче</option>
            <option value="sharper">Язвительнее</option>
            <option value="quieter">Тише</option>
            <option value="technical">Техничнее</option>
          </select>
        </label>
        <div className="onboarding-toggles">
          <label className="settings-toggle-field" role="switch" aria-checked={settings.userMemoryEnabled}>
            <input type="checkbox" checked={settings.userMemoryEnabled} onChange={(event) => onChange({ ...settings, userMemoryEnabled: event.currentTarget.checked })} />
            <span>Память</span>
          </label>
          <small className="settings-note">Ari запоминает факты о тебе и прошлые разговоры — только с твоего согласия.</small>
          <label className="settings-toggle-field" role="switch" aria-checked={settings.proactiveEnabled}>
            <input type="checkbox" checked={settings.proactiveEnabled} onChange={(event) => onChange({ ...settings, proactiveEnabled: event.currentTarget.checked })} />
            <span>Инициатива</span>
          </label>
          <small className="settings-note">Самостоятельные реплики: утренний чек-ин, напоминания, реакции на возвращение.</small>
          <label className="settings-toggle-field" role="switch" aria-checked={settings.activityTrackingEnabled}>
            <input type="checkbox" checked={settings.activityTrackingEnabled} onChange={(event) => onChange({ ...settings, activityTrackingEnabled: event.currentTarget.checked })} />
            <span>Контекст окна</span>
          </label>
          <small className="settings-note">Ari видит, в каком приложении ты работаешь — для уместных комментариев, не для слежки.</small>
          <label className="settings-toggle-field" role="switch" aria-checked={settings.clipboardFullCaptureEnabled}>
            <input
              type="checkbox"
              checked={settings.clipboardFullCaptureEnabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  clipboardFullCaptureEnabled: event.currentTarget.checked,
                })
              }
            />
            <span>Контекст буфера обмена</span>
          </label>
          <small className="settings-note">
            По явному согласию Ari может локально замечать отладочные фрагменты.
            Секреты редактируются; proactive-first профиль включает этот сигнал для более уместных инициатив.
          </small>
          <label className="settings-toggle-field" role="switch" aria-checked={settings.ideAdvisorEnabled}>
            <input
              type="checkbox"
              checked={settings.ideAdvisorEnabled}
              onChange={(event) =>
                onChange({ ...settings, ideAdvisorEnabled: event.currentTarget.checked })
              }
            />
            <span>IDE Advisor (VS Code)</span>
          </label>
          <small className="settings-note">
            Запускает локальный IDE Bridge только после этого согласия. Файлы, diagnostics, Git, tests и unsaved-буферы включаются отдельно в VS Code.
          </small>
          <label className="settings-toggle-field" role="switch" aria-checked={settings.remindersEnabled}>
            <input type="checkbox" checked={settings.remindersEnabled} onChange={(event) => onChange({ ...settings, remindersEnabled: event.currentTarget.checked })} />
            <span>Напоминания</span>
          </label>
          <small className="settings-note">Мягкие напоминания о делах и намерениях, которые ты сохранил.</small>
        </div>
        <p className="settings-note">
          Ari всегда на рабочем столе: ambient-пузыри без открытия чата, реакции на смену
          окон и долгую игру, панель «Дела» и фокус-сессии. Пресет «Компаньон» включает
          память, инициативу, контекст окна и реакции на события.
        </p>
        <button
          type="button"
          className="settings-action-button"
          onClick={() =>
            onChange({
              ...settings,
              userMemoryEnabled: true,
              proactiveEnabled: true,
              remindersEnabled: true,
              activityTrackingEnabled: true,
              eventReactionsEnabled: true,
              initiativeLevel: "active",
              proactiveSmalltalkIntervalMinutes: 3,
              proactiveAdviceIntervalMinutes: 5,
              proactiveIntervalMinutes: 5,
            })
          }
        >
          Пресет «Компаньон»
        </button>

        {checkMessage ? (
          <p className="settings-note settings-error">{checkMessage}</p>
        ) : checkState === "ready" ? (
          <p className="settings-note">Подключение в порядке.</p>
        ) : null}

        <div className="onboarding-actions">
          <button
            className="settings-action-button primary"
            type="button"
            disabled={checkState === "checking"}
            onClick={() => void handleStart()}
          >
            {checkState === "checking" ? "Проверяю…" : "Начнём"}
          </button>
          {checkState === "offline" && (
            <button
              className="settings-action-button"
              type="button"
              onClick={() => void handleStart(true)}
            >
              Всё равно начать
            </button>
          )}
          <button
            className="ghost-button"
            type="button"
            onClick={() =>
              window.dispatchEvent(new Event("ari-open-settings"))
            }
          >
            Открыть настройки
          </button>
        </div>
      </section>
    </div>
  );
}
