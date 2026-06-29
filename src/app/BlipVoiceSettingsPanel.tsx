import { useState } from "react";
import type { AppSettings, VoiceStyle } from "../settings/appSettings";
import { blipVoiceManager } from "../character/blipVoiceManager";

type BlipVoiceSettingsPanelProps = {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onBack: () => void;
  embedded?: boolean;
};

function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-toggle-field">
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function BlipVoiceSettingsPanel({
  settings,
  onChange,
  onBack,
  embedded = false,
}: BlipVoiceSettingsPanelProps) {
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  async function testVoice() {
    setTesting(true);
    setTestError("");
    try {
      await blipVoiceManager.testVoice(settings, "happy");
    } catch (error) {
      setTestError(
        error instanceof Error ? error.message : "Не удалось проиграть blip voice.",
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className={`settings-panel blip-voice-settings-panel${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <div className="settings-title-row">
          <div>
            <strong>Голос Ari — Blip Voice</strong>
            <span>Щебет во время появления текста, без синтеза речи.</span>
          </div>
          <button type="button" className="settings-back-button" onClick={onBack}>
            ← Назад
          </button>
        </div>
      )}

      <div className="settings-section-card">
        <label>
          Стиль голоса
          <select
            value={settings.voiceStyle}
            onChange={(event) =>
              update("voiceStyle", event.target.value as VoiceStyle)
            }
          >
            <option value="off">Выключен</option>
            <option value="blip">Blip voice</option>
          </select>
        </label>
      </div>

      <div className="settings-section-card">
        <label>
          Громкость
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.blipVolume}
            onChange={(event) =>
              update("blipVolume", Number(event.target.value))
            }
          />
        </label>
        <label>
          Высота
          <input
            type="range"
            min={0.7}
            max={1.5}
            step={0.05}
            value={settings.blipPitch}
            onChange={(event) =>
              update("blipPitch", Number(event.target.value))
            }
          />
        </label>
        <label>
          Скорость печати и blip
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={settings.blipSpeed}
            onChange={(event) =>
              update("blipSpeed", Number(event.target.value))
            }
          />
        </label>
        <ToggleField
          label="Эмоциональный pitch"
          hint="Менять высоту и ритм по настроению Ari"
          checked={settings.blipEmotionPitch}
          onChange={(value) => update("blipEmotionPitch", value)}
        />
      </div>

      <div className="settings-section-card">
        <ToggleField
          label="Озвучивать ответы в чате"
          checked={settings.blipSpeakReplies}
          onChange={(value) => update("blipSpeakReplies", value)}
        />
        <ToggleField
          label="Озвучивать инициативы"
          checked={settings.blipSpeakInitiative}
          onChange={(value) => update("blipSpeakInitiative", value)}
        />
        <ToggleField
          label="Озвучивать Pomodoro"
          checked={settings.blipSpeakPomodoro}
          onChange={(value) => update("blipSpeakPomodoro", value)}
        />
        <ToggleField
          label="Только короткие ответы"
          hint="Длинные ответы — короткий murmur в начале"
          checked={settings.blipShortRepliesOnly}
          onChange={(value) => update("blipShortRepliesOnly", value)}
        />
        <ToggleField
          label="Тишина в focus mode"
          checked={settings.blipMuteDuringFocus}
          onChange={(value) => update("blipMuteDuringFocus", value)}
        />
        <ToggleField
          label="Тишина ночью"
          checked={settings.blipMuteAtNight}
          onChange={(value) => update("blipMuteAtNight", value)}
        />
        <ToggleField
          label="Тишина в quiet mode"
          checked={settings.blipMuteInQuietMode}
          onChange={(value) => update("blipMuteInQuietMode", value)}
        />
        <label>
          Лимит авто-blip (символов)
          <input
            type="number"
            min={120}
            max={1200}
            value={settings.blipMaxReplyChars}
            onChange={(event) =>
              update("blipMaxReplyChars", Number(event.target.value))
            }
          />
        </label>
      </div>

      <div className="settings-section-card">
        <div className="blip-test-row">
          <button
            type="button"
            className="blip-action-btn"
            disabled={testing}
            onClick={() => void testVoice()}
          >
            {testing ? "Проигрываю…" : "Проверить blip"}
          </button>
          <button
            type="button"
            className="blip-stop-btn"
            onClick={() => blipVoiceManager.stop()}
          >
            Стоп
          </button>
        </div>
        {testError ? (
          <span className="settings-note settings-error">{testError}</span>
        ) : null}
      </div>
    </div>
  );
}
