import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeSource = {
  buffer: unknown;
  playbackRate: { value: number };
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

const sources: FakeSource[] = [];

function createSource(): FakeSource {
  const source: FakeSource = {
    buffer: null,
    playbackRate: { value: 1 },
    onended: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(() => source.onended?.()),
  };
  sources.push(source);
  return source;
}

function setupAudioContext(): void {
  sources.length = 0;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  vi.stubGlobal(
    "AudioContext",
    vi.fn(() => ({
      state: "running",
      sampleRate: 44_100,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      createBuffer: vi.fn((_channels: number, length: number) => ({
        getChannelData: () => new Float32Array(length),
      })),
      createBufferSource: vi.fn(createSource),
      createGain: vi.fn(() => ({
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      decodeAudioData: vi.fn(),
    })),
  );
}

describe("blipBank", () => {
  beforeEach(() => {
    vi.resetModules();
    setupAudioContext();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves playBlip only after the audio source ends", async () => {
    const { playBlip } = await import("../src/character/blipBank");
    let resolved = false;
    const promise = playBlip({ token: "a", pitch: 1, volume: 0.2 }).then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(sources).toHaveLength(1);
    expect(sources[0]?.start).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);

    sources[0]?.onended?.();
    await promise;

    expect(resolved).toBe(true);
    expect(sources[0]?.disconnect).toHaveBeenCalled();
  });

  it("plays multiple blips sequentially when awaited", async () => {
    const { playBlip } = await import("../src/character/blipBank");

    const first = playBlip({ token: "a", pitch: 1, volume: 0.2 });
    await Promise.resolve();
    sources[0]?.onended?.();
    await first;

    const second = playBlip({ token: "e", pitch: 1, volume: 0.2 });
    await Promise.resolve();
    sources[1]?.onended?.();
    await second;

    expect(sources).toHaveLength(2);
    expect(sources[0]?.start).toHaveBeenCalledTimes(1);
    expect(sources[1]?.start).toHaveBeenCalledTimes(1);
  });
});
