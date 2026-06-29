import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/platform/secretRedaction";

describe("redactSecrets", () => {
  it("removes bearer tokens and api keys", () => {
    const stripeLikeKey = `sk_${"live"}_abcdefghijklmnopqrstuvwxyz`;
    const input =
      `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def ${stripeLikeKey}`;
    const output = redactSecrets(input);
    expect(output).not.toContain("sk_live_");
    expect(output).not.toMatch(/Bearer\s+\S+/i);
  });

  it("redacts password assignments and env lines", () => {
    const input = "password=supersecret\nAPI_KEY=not-for-storage";
    const output = redactSecrets(input);
    expect(output).not.toContain("supersecret");
    expect(output).not.toContain("not-for-storage");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts long hex blobs", () => {
    const hex = "a".repeat(48);
    expect(redactSecrets(`hash=${hex}`)).not.toContain(hex);
  });

  it("leaves normal code snippets mostly intact", () => {
    const code = "const answer = 42;\nconsole.log(answer);";
    expect(redactSecrets(code)).toBe(code);
  });
});
