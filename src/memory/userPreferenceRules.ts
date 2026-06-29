export type UserPreferenceRule = {
  id: string;
  text: string;
  category: "tone" | "format" | "boundaries" | "workflow" | "visual";
  enabled: boolean;
  createdAt: number;
};

const RULES_KEY = "desktop-character.user-preference-rules.v1";

export function loadPreferenceRules(): UserPreferenceRule[] {
  try {
    const stored = localStorage.getItem(RULES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as UserPreferenceRule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePreferenceRules(rules: UserPreferenceRule[]): void {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  window.dispatchEvent(new CustomEvent("ari-preference-rules-changed"));
}

export function addPreferenceRule(
  text: string,
  category: UserPreferenceRule["category"] = "workflow",
): UserPreferenceRule {
  const rule: UserPreferenceRule = {
    id: crypto.randomUUID(),
    text: text.trim().slice(0, 500),
    category,
    enabled: true,
    createdAt: Date.now(),
  };
  const rules = [...loadPreferenceRules(), rule];
  savePreferenceRules(rules);
  return rule;
}

export function updatePreferenceRule(
  id: string,
  patch: Partial<Pick<UserPreferenceRule, "text" | "category" | "enabled">>,
): void {
  const rules = loadPreferenceRules().map((rule) =>
    rule.id === id ? { ...rule, ...patch, text: patch.text?.trim().slice(0, 500) ?? rule.text } : rule,
  );
  savePreferenceRules(rules);
}

export function removePreferenceRule(id: string): void {
  savePreferenceRules(loadPreferenceRules().filter((rule) => rule.id !== id));
}

export function parsePreferenceRule(text: string): UserPreferenceRule {
  const lower = text.toLowerCase();
  let category: UserPreferenceRule["category"] = "workflow";
  if (/не называй|не шути|не говори|границ|запрет/i.test(lower)) {
    category = "boundaries";
  } else if (/коротк|шаг|формат|сначала|потом/i.test(lower)) {
    category = "format";
  } else if (/тон|ирони|тепл|мягк/i.test(lower)) {
    category = "tone";
  } else if (/анимац|выражен|эмоци/i.test(lower)) {
    category = "visual";
  }
  return addPreferenceRule(text, category);
}

export function describePreferenceRules(): string {
  const enabled = loadPreferenceRules().filter((rule) => rule.enabled);
  if (!enabled.length) return "";
  return enabled.map((rule) => `- ${rule.text}`).join("\n");
}
