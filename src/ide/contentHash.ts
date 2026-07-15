import type { IdeTextPayload, IdeWorkspaceSnapshot } from "./protocol";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Text(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function createIdeTextPayload(
  value: string,
  options: { truncatedAtSource?: boolean } = {},
): Promise<IdeTextPayload> {
  return {
    value,
    sha256: await sha256Text(value),
    byteLength: new TextEncoder().encode(value).byteLength,
    truncatedAtSource: options.truncatedAtSource,
  };
}

export async function verifyIdeTextPayload(payload: IdeTextPayload): Promise<boolean> {
  if (!SHA256_PATTERN.test(payload.sha256)) return false;
  const byteLength = new TextEncoder().encode(payload.value).byteLength;
  if (byteLength !== payload.byteLength) return false;
  return (await sha256Text(payload.value)) === payload.sha256;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function serializeSnapshotForHash(snapshot: IdeWorkspaceSnapshot): string {
  const hashable: Partial<IdeWorkspaceSnapshot> = { ...snapshot };
  delete hashable.snapshotSha256;
  return JSON.stringify(canonicalize(hashable));
}

export async function createSnapshotHash(snapshot: IdeWorkspaceSnapshot): Promise<string> {
  return sha256Text(serializeSnapshotForHash(snapshot));
}

export async function verifySnapshotHash(snapshot: IdeWorkspaceSnapshot): Promise<boolean> {
  if (!SHA256_PATTERN.test(snapshot.snapshotSha256)) return false;
  return (await createSnapshotHash(snapshot)) === snapshot.snapshotSha256;
}
