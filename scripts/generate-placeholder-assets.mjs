import { writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function solidPng(width, height, [r, g, b, a = 255]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = r;
    row[offset + 1] = g;
    row[offset + 2] = b;
    row[offset + 3] = a;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const compressed = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngToIco(pngBuffer) {
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width;
  entry[1] = height >= 256 ? 0 : height;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, pngBuffer]);
}

function writePng(path, width, height, color) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, solidPng(width, height, color));
}

function writeIcoFromPng(path, width, height, color) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pngToIco(solidPng(width, height, color)));
}

const spriteFiles = [
  "idle.png",
  "speaking.png",
  "neutral.png",
  "happy.png",
  "amused.png",
  "annoyed.png",
  "curious.png",
  "empathetic.png",
  "blush.png",
  "bored.png",
  "calm smile.png",
  "surprised.png",
  "sad.png",
  "sleepy.png",
  "excited.png",
  "pensive.png",
  "worried.png",
  "proud.png",
  "shy.png",
  "determined.png",
];

const hues = [
  [210, 170, 230],
  [255, 200, 220],
  [180, 220, 255],
  [255, 210, 170],
  [200, 255, 210],
];

const MIN_REAL_SPRITE_BYTES = 8_000;

spriteFiles.forEach((file, index) => {
  const target = join(root, "public/characters/ari/alpha", file);
  if (existsSync(target) && statSync(target).size >= MIN_REAL_SPRITE_BYTES) {
    return;
  }
  const [r, g, b] = hues[index % hues.length];
  writePng(target, 180, 280, [r, g, b, 255]);
});

writePng(join(root, "public/app-icon.png"), 256, 256, [210, 170, 230, 255]);

const tauriIconSource = join(root, "src-tauri/icons/icon.png");
if (!existsSync(tauriIconSource)) {
  for (const size of [32, 128, 256]) {
    writePng(
      join(root, `src-tauri/icons/${size}x${size}.png`),
      size,
      size,
      [210, 170, 230, 255],
    );
  }
  writeFileSync(
    join(root, "src-tauri/icons/128x128@2x.png"),
    solidPng(256, 256, [210, 170, 230, 255]),
  );
  writeIcoFromPng(join(root, "src-tauri/icons/icon.ico"), 256, 256, [
    210, 170, 230, 255,
  ]);
  console.log(
    "Tauri icon source missing — wrote placeholder PNG/ICO. Run: npx tauri icon src-tauri/icons/icon.png",
  );
} else {
  console.log("Skipped Tauri bundle icons (existing icon.png). Run tauri icon to refresh.");
}

console.log("Placeholder sprites and icons generated.");
