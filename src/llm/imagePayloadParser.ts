export function sanitizeBase64ImagePayload(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    return comma >= 0 ? trimmed.slice(comma + 1).replace(/\s+/g, "") : trimmed;
  }
  return trimmed.replace(/\s+/g, "");
}
