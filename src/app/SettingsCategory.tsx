import type { ReactNode } from "react";
import type { SettingsCategoryId } from "./settingsCategoryIds";

type SettingsCategoryProps = {
  id: SettingsCategoryId;
  title: string;
  description?: string;
  badge?: string;
  expanded: boolean;
  onToggle: (id: SettingsCategoryId) => void;
  children: ReactNode;
};

export function SettingsCategory({
  id,
  title,
  description,
  badge,
  expanded,
  onToggle,
  children,
}: SettingsCategoryProps) {
  return (
    <section
      className={`settings-category${expanded ? " expanded" : ""}`}
      data-category={id}
    >
      <button
        type="button"
        className="settings-category-header"
        aria-expanded={expanded}
        onClick={() => onToggle(id)}
      >
        <span className="settings-category-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="settings-category-text">
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </span>
        {badge ? <span className="settings-category-badge">{badge}</span> : null}
      </button>
      {expanded ? (
        <div className="settings-category-body">{children}</div>
      ) : null}
    </section>
  );
}
