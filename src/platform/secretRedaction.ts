const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9\-._~+/]+=*\.eyJ[A-Za-z0-9\-._~+/]+=*\.[A-Za-z0-9\-._~+/]+=*\b/g;
const API_KEY_PATTERN =
  /\b(?:sk|pk|xox[baprs]-|AIza|gh[pousr]_)[A-Za-z0-9\-_]{16,}\b/g;
const AWS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;
const SECRET_ASSIGNMENT_PATTERN =
  /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi;
const ENV_LINE_PATTERN = /^\s*[A-Z][A-Z0-9_]{2,}\s*=\s*.+$/gm;
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{40,}\b/g;
const LONG_BASE64_PATTERN = /\b[A-Za-z0-9+/]{48,}={0,2}\b/g;

const REDACTED = "[REDACTED]";

export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }

  return text
    .replace(BEARER_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(API_KEY_PATTERN, REDACTED)
    .replace(AWS_KEY_PATTERN, REDACTED)
    .replace(SECRET_ASSIGNMENT_PATTERN, (match) => {
      const separatorIndex = Math.max(match.indexOf("="), match.indexOf(":"));
      if (separatorIndex < 0) {
        return REDACTED;
      }
      return `${match.slice(0, separatorIndex + 1)} ${REDACTED}`;
    })
    .replace(ENV_LINE_PATTERN, (line) => {
      const separatorIndex = Math.max(line.indexOf("="), line.indexOf(":"));
      if (separatorIndex < 0) {
        return REDACTED;
      }
      return `${line.slice(0, separatorIndex + 1)} ${REDACTED}`;
    })
    .replace(LONG_HEX_PATTERN, REDACTED)
    .replace(LONG_BASE64_PATTERN, REDACTED);
}

export function redactAndTruncate(text: string, maxLength: number): string {
  return redactSecrets(text).slice(0, maxLength);
}
