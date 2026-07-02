export type ClipboardNode = {
  name: string;
  values: string[];
};

export type ClipboardRelation = {
  from: string;
  to: string;
  operator: string;
};

export type ClipboardSemantics = {
  nodes: ClipboardNode[];
  relations: ClipboardRelation[];
  identifiers: string[];
  files: string[];
  rich: boolean;
  summary: string;
};

const STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "can",
  "chat",
  "command",
  "for",
  "from",
  "message",
  "offline",
  "quiet",
  "the",
  "user",
  "with",
]);

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanIdentifier(value: string): string {
  return value
    .replace(/\{.*\}/s, "")
    .replace(/^[^A-Za-z_$]+|[^A-Za-z0-9_$]+$/g, "")
    .trim();
}

function splitNodeValues(value: string): string[] {
  return unique(
    value
      .replace(/\s+/g, " ")
      .split(/[;,|?]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  ).slice(0, 5);
}

function looksLikeUsefulIdentifier(value: string): boolean {
  if (value.length < 3 || STOP_WORDS.has(value.toLowerCase())) {
    return false;
  }
  return (
    /[A-Z]/.test(value[0]) ||
    /[A-Z][a-z]+[A-Z]/.test(value) ||
    /[_$]/.test(value) ||
    /^[A-Z0-9_]{3,}$/.test(value)
  );
}

export function extractClipboardSemantics(text: string): ClipboardSemantics {
  const trimmed = text.trim();
  const nodes: ClipboardNode[] = [];
  const relations: ClipboardRelation[] = [];
  const identifiers: string[] = [];
  const files = unique(trimmed.match(/\b[\w.-]+\.(?:tsx?|jsx?|rs|py|md|json|toml|css|html)\b/gi) ?? []).slice(0, 5);

  for (const match of trimmed.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{1,48})\s*\{([^{}]{1,160})\}/gs)) {
    const name = match[1]?.trim();
    if (!name) {
      continue;
    }
    nodes.push({
      name,
      values: splitNodeValues(match[2] ?? ""),
    });
    identifiers.push(name);
  }

  for (const match of trimmed.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\{[^{}]{0,160}\})?)\s*(-->|->|=>|→)\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\s*\{[^{}]{0,160}\})?)/gs)) {
    const from = cleanIdentifier(match[1] ?? "");
    const to = cleanIdentifier(match[3] ?? "");
    if (!from || !to) {
      continue;
    }
    relations.push({ from, to, operator: match[2] ?? "->" });
    identifiers.push(from, to);
  }

  for (const match of trimmed.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g)) {
    const value = match[0];
    if (looksLikeUsefulIdentifier(value)) {
      identifiers.push(value);
    }
  }

  const uniqueIdentifiers = unique(identifiers)
    .filter((value) => !files.includes(value))
    .slice(0, 10);
  const hasStructuralSyntax = /(?:-->|->|=>|→|[{}[\]()]|::|\.\w+)/.test(trimmed);
  const rich =
    nodes.length > 0 ||
    relations.length > 0 ||
    files.length > 0 ||
    (hasStructuralSyntax && uniqueIdentifiers.length >= 2);

  const parts: string[] = [];
  if (nodes.length) {
    parts.push(
      `узлы: ${nodes
        .slice(0, 4)
        .map((node) =>
          node.values.length
            ? `${node.name}(${node.values.join(" / ")})`
            : node.name,
        )
        .join(", ")}`,
    );
  }
  if (relations.length) {
    parts.push(
      `связи: ${relations
        .slice(0, 3)
        .map((relation) => `${relation.from} ${relation.operator} ${relation.to}`)
        .join(", ")}`,
    );
  }
  if (files.length) {
    parts.push(`файлы: ${files.join(", ")}`);
  }
  if (uniqueIdentifiers.length) {
    parts.push(`идентификаторы: ${uniqueIdentifiers.slice(0, 6).join(", ")}`);
  }

  return {
    nodes,
    relations,
    identifiers: uniqueIdentifiers,
    files,
    rich,
    summary: parts.join("; "),
  };
}

export function isClipboardSemanticallyRich(text: string): boolean {
  return extractClipboardSemantics(text).rich;
}

export function describeClipboardSemantics(text: string): string {
  return extractClipboardSemantics(text).summary;
}

export function clipboardPrimaryAnchors(text: string): string[] {
  const semantics = extractClipboardSemantics(text);
  return unique([
    ...semantics.nodes.map((node) => node.name),
    ...semantics.relations.flatMap((relation) => [relation.from, relation.to]),
    ...semantics.identifiers,
    ...semantics.files,
  ]).slice(0, 8);
}
