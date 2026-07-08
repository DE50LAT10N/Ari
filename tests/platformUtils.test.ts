import { describe, expect, it } from "vitest";
import {
  clamp,
  clamp01,
  clampSignedUnit,
  clampUnit,
  clipWeight,
  sigmoid,
} from "../src/platform/mathUtils";
import { hashStringDjb2 } from "../src/platform/hashUtils";
import {
  normalizeComparableText,
  normalizeForOverlap,
} from "../src/platform/textNormalize";
import { truncateWithEllipsis } from "../src/platform/textUtils";
import { loadJson, saveJsonTail } from "../src/platform/jsonStorage";
import { parseJsonSafe, httpErrorFromResponse } from "../src/platform/httpUtils";
import { redactAndTruncate } from "../src/platform/secretRedaction";
import { sanitizeBase64ImagePayload } from "../src/llm/imagePayloadParser";

describe("platform mathUtils", () => {
  it("clamps signed unit range", () => {
    expect(clampSignedUnit(2)).toBe(1);
    expect(clampSignedUnit(-2)).toBe(-1);
  });

  it("clamps unit range", () => {
    expect(clampUnit(1.2)).toBe(1);
    expect(clampUnit(-0.1)).toBe(0);
  });

  it("clamps generic range", () => {
    expect(clamp(5, 0, 3)).toBe(3);
  });

  it("clamps01 with NaN guard", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(0.8)).toBe(0.8);
  });

  it("clips weights and computes sigmoid", () => {
    expect(clipWeight(2, 0.7)).toBe(0.7);
    expect(clipWeight(-2, 0.7)).toBe(-0.7);
    expect(sigmoid(0)).toBe(0.5);
  });
});

describe("platform hashUtils", () => {
  it("returns stable positive hash", () => {
    expect(hashStringDjb2("abc")).toBe(hashStringDjb2("abc"));
    expect(hashStringDjb2("abc")).toBeGreaterThanOrEqual(0);
  });
});

describe("platform text utils", () => {
  it("normalizes overlap text", () => {
    expect(normalizeForOverlap("Hello!")).toBe("hello");
  });

  it("normalizes comparable text", () => {
    expect(normalizeComparableText("Hello, World")).toBe("hello world");
  });

  it("truncates with ellipsis", () => {
    expect(truncateWithEllipsis("abcdef", 4)).toBe("abcd…");
  });
});

describe("platform jsonStorage", () => {
  it("loadJson returns fallback on missing key", () => {
    expect(loadJson("missing-test-key", { ok: true })).toEqual({ ok: true });
  });

  it("saveJsonTail keeps last items", () => {
    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    const key = "desktop-character.test-tail.v1";
    saveJsonTail(key, [1, 2, 3, 4], 2);
    expect(loadJson<number[]>(key, [])).toEqual([3, 4]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  });
});

describe("platform httpUtils", () => {
  it("parseJsonSafe falls back", () => {
    expect(parseJsonSafe("{bad", { x: 1 })).toEqual({ x: 1 });
  });

  it("formats http errors", () => {
    expect(httpErrorFromResponse(500, "boom", "Ollama")).toContain("HTTP 500");
  });
});

describe("imagePayloadParser", () => {
  it("strips data URL prefix and whitespace", () => {
    expect(
      sanitizeBase64ImagePayload(" data:image/png;base64, ab c\n "),
    ).toBe("abc");
  });
});

describe("secretRedaction", () => {
  it("redacts and truncates", () => {
    const value = redactAndTruncate("token=secretvalue", 12);
    expect(value.length).toBeLessThanOrEqual(12);
  });
});
