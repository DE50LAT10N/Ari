import type { BlipToken } from "./blipSyllables";

const BLIP_BASE_PATH = "/audio/ari/blips/default";

const tokenFrequencies: Record<BlipToken, number> = {
  a: 440,
  e: 520,
  i: 620,
  o: 360,
  u: 300,
  ya: 480,
  mi: 500,
  ne: 450,
  hm: 260,
  eh: 390,
  n: 340,
};

let audioContext: AudioContext | null = null;
const bufferCache = new Map<BlipToken, AudioBuffer>();

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function synthesizeProceduralBlip(token: BlipToken): AudioBuffer {
  const context = getAudioContext();
  const sampleRate = context.sampleRate;
  const durationSec = 0.07;
  const length = Math.floor(sampleRate * durationSec);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const baseFreq = tokenFrequencies[token];
  const formant = baseFreq * 1.6;

  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate;
    const attack = Math.min(1, t / 0.008);
    const release = Math.exp(-t * 28);
    const envelope = attack * release;
    const vibrato = 1 + Math.sin(t * 42) * 0.03;
    const fundamental =
      Math.sin(2 * Math.PI * baseFreq * vibrato * t) * 0.55;
    const harmonic =
      Math.sin(2 * Math.PI * formant * t) * 0.25;
    const noise = (Math.random() * 2 - 1) * 0.04;
    data[index] = (fundamental + harmonic + noise) * envelope * 0.45;
  }

  return buffer;
}

export async function preloadBlipBank(): Promise<void> {
  const tokens: BlipToken[] = [
    "a",
    "e",
    "i",
    "o",
    "u",
    "ya",
    "mi",
    "ne",
    "hm",
    "eh",
    "n",
  ];
  await Promise.all(tokens.map((token) => loadBlipBuffer(token)));
}

export async function loadBlipBuffer(token: BlipToken): Promise<AudioBuffer> {
  const cached = bufferCache.get(token);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`${BLIP_BASE_PATH}/${token}.wav`);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await getAudioContext().decodeAudioData(arrayBuffer);
      bufferCache.set(token, decoded);
      return decoded;
    }
  } catch {
    // fall through to procedural synthesis
  }

  const procedural = synthesizeProceduralBlip(token);
  bufferCache.set(token, procedural);
  return procedural;
}

export type PlayBlipOptions = {
  token: BlipToken;
  pitch: number;
  volume: number;
  durationScale?: number;
};

const activeSources = new Set<AudioBufferSourceNode>();

export async function playBlip(options: PlayBlipOptions): Promise<void> {
  const context = getAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }

  const buffer = await loadBlipBuffer(options.token);
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  source.playbackRate.value = Math.max(0.5, Math.min(2.2, options.pitch));
  gain.gain.value = Math.max(0, Math.min(1, options.volume));
  source.connect(gain);
  gain.connect(context.destination);
  activeSources.add(source);
  source.onended = () => activeSources.delete(source);
  source.start();
}

export function stopAllBlips(): void {
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      // already stopped
    }
  }
  activeSources.clear();
}

export async function ensureAudioReady(): Promise<void> {
  const context = getAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }
}
