export type AriLogLevel = "debug" | "info" | "warn" | "error";

const MAX_STRING = 240;

function trimValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.map(trimValue);
  }
  if (value && typeof value === "object") {
    return trimPayload(value as Record<string, unknown>);
  }
  return value;
}

function trimPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    trimmed[key] = trimValue(value);
  }
  return trimmed;
}

function serializeDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
    };
  }
  return details;
}

export function ariLog(
  scope: string,
  level: AriLogLevel,
  payload?: Record<string, unknown>,
): void {
  if (level === "debug" && !import.meta.env.DEV) {
    return;
  }
  const prefix = `[ari:${scope}]`;
  const data = payload ? trimPayload(payload) : undefined;
  switch (level) {
    case "debug":
      console.debug(prefix, data ?? "");
      break;
    case "info":
      console.info(prefix, data ?? "");
      break;
    case "warn":
      console.warn(prefix, data ?? "");
      break;
    case "error":
      console.error(prefix, data ?? "");
      break;
  }
}

export function logInfo(message: string, details?: unknown): void {
  ariLog("app", "info", {
    message,
    ...(details === undefined ? {} : { details: serializeDetails(details) }),
  });
}

export function logError(message: string, details?: unknown): void {
  ariLog("error", "error", {
    message,
    ...(details === undefined ? {} : { details: serializeDetails(details) }),
  });
}
