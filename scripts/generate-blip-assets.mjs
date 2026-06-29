/**
 * Generates original short blip WAV files for Ari Blip Voice.
 * Run: node scripts/generate-blip-assets.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "audio", "ari", "blips", "default");

const tokens = {
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

function encodeWav(samples, sampleRate = 22050) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }

  return buffer;
}

function synthesize(freq, durationSec = 0.08, sampleRate = 22050) {
  const length = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(length);
  const formant = freq * 1.65;

  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate;
    const attack = Math.min(1, t / 0.01);
    const release = Math.exp(-t * 24);
    const envelope = attack * release;
    const vibrato = 1 + Math.sin(t * 38) * 0.035;
    const fundamental = Math.sin(2 * Math.PI * freq * vibrato * t) * 0.58;
    const harmonic = Math.sin(2 * Math.PI * formant * t) * 0.22;
    const noise = (Math.random() * 2 - 1) * 0.035;
    samples[index] = (fundamental + harmonic + noise) * envelope * 0.42;
  }

  return samples;
}

await mkdir(outDir, { recursive: true });

for (const [token, frequency] of Object.entries(tokens)) {
  const wav = encodeWav(synthesize(frequency));
  const target = path.join(outDir, `${token}.wav`);
  await writeFile(target, wav);
  console.log(`Wrote ${target}`);
}

console.log("Done.");
