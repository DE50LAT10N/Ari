type OllamaModelPickerProps = {
  value: string;
  models: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
};

export function OllamaModelPicker({
  value,
  models,
  onChange,
  placeholder,
  allowEmpty = false,
}: OllamaModelPickerProps) {
  if (models.length === 0) {
    return (
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  const unknownCurrent = value.length > 0 && !models.includes(value);

  return (
    <select
      value={allowEmpty ? value : unknownCurrent ? value : value || models[0]}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {allowEmpty && (
        <option value="">{placeholder ?? "— как основная модель —"}</option>
      )}
      {unknownCurrent && <option value={value}>{value}</option>}
      {models.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </select>
  );
}
