import type { AppSettings } from "../settings/appSettings";
import { getEmbeddingSource } from "./embeddingConfig";
import { getVisionSource } from "./visionConfig";

export function needsOllamaModelCatalog(settings: AppSettings): boolean {
  return (
    settings.llmProvider === "ollama" ||
    getEmbeddingSource(settings) === "ollama" ||
    getVisionSource(settings) === "ollama"
  );
}

export function expandOllamaModelNames(models: string[]): string[] {
  const expanded = new Set<string>();

  for (const model of models) {
    const trimmed = model.trim();
    if (!trimmed) {
      continue;
    }
    expanded.add(trimmed);

    const withoutLatest = trimmed.replace(/:latest$/i, "");
    if (withoutLatest !== trimmed) {
      expanded.add(withoutLatest);
    }

    if (!trimmed.includes(":")) {
      expanded.add(`${trimmed}:latest`);
    }
  }

  return [...expanded].sort((left, right) =>
    left.localeCompare(right, "ru"),
  );
}

export function isOllamaModelAvailable(
  model: string,
  installed: string[],
): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return installed.some((name) => {
    const lower = name.toLowerCase();
    if (lower === normalized) {
      return true;
    }
    if (lower.startsWith(`${normalized}:`)) {
      return true;
    }
    if (normalized.startsWith(`${lower}:`)) {
      return true;
    }
    const normalizedBase = normalized.split(":")[0];
    const installedBase = lower.split(":")[0];
    return normalizedBase === installedBase && normalized.includes(":");
  });
}
