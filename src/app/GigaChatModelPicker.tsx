import { useState } from "react";
import {
  GIGA_CHAT_EMBEDDING_MODELS,
  type GigaChatModelOption,
} from "../llm/gigaChatModels";

type GigaChatModelPickerProps = {
  value: string;
  options: readonly GigaChatModelOption[];
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
};

const CUSTOM_VALUE = "__custom__";

export function GigaChatModelPicker({
  value,
  options,
  onChange,
  allowEmpty = false,
  emptyLabel = "— как основная модель чата —",
}: GigaChatModelPickerProps) {
  const knownIds = new Set(options.map((option) => option.id));
  const isKnown = !value || knownIds.has(value);
  const [customMode, setCustomMode] = useState(!isKnown && value.length > 0);

  const selectValue = allowEmpty && !value
    ? ""
    : customMode || (!isKnown && value)
      ? CUSTOM_VALUE
      : value;

  function handleSelectChange(next: string) {
    if (next === CUSTOM_VALUE) {
      setCustomMode(true);
      if (!value || knownIds.has(value)) {
        onChange("");
      }
      return;
    }
    setCustomMode(false);
    onChange(next);
  }

  const selected = options.find((option) => option.id === value);

  return (
    <div className="gigachat-model-picker">
      <select
        value={selectValue}
        onChange={(event) => handleSelectChange(event.currentTarget.value)}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        <optgroup label="Рекомендуемые">
          {options
            .filter((option) => !option.legacy)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
        </optgroup>
        {options.some((option) => option.legacy) && (
          <optgroup label="Legacy (редирект API)">
            {options
              .filter((option) => option.legacy)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        )}
        <option value={CUSTOM_VALUE}>Своя модель (вручную)…</option>
      </select>
      {(customMode || selectValue === CUSTOM_VALUE) && (
        <input
          className="gigachat-model-picker-custom"
          value={value}
          placeholder="GigaChat-2-Pro"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
      {selected && !customMode && (
        <small className="settings-note">{selected.hint}</small>
      )}
    </div>
  );
}

type GigaChatEmbeddingPickerProps = {
  value: string;
  onChange: (value: string) => void;
};

export function GigaChatEmbeddingPicker({
  value,
  onChange,
}: GigaChatEmbeddingPickerProps) {
  const known = GIGA_CHAT_EMBEDDING_MODELS.some((option) => option.id === value);
  const [customMode, setCustomMode] = useState(!known && value.length > 0);

  return (
    <div className="gigachat-model-picker">
      <select
        value={customMode ? CUSTOM_VALUE : value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === CUSTOM_VALUE) {
            setCustomMode(true);
            return;
          }
          setCustomMode(false);
          onChange(next);
        }}
      >
        {GIGA_CHAT_EMBEDDING_MODELS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Своя модель…</option>
      </select>
      {customMode && (
        <input
          className="gigachat-model-picker-custom"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </div>
  );
}
