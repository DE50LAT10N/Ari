import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certDir = path.join(rootDir, "src-tauri", "certs");

const sources = [
  {
    url: "https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt",
    file: "russian_trusted_root_ca.pem",
  },
  {
    url: "https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt",
    file: "russian_trusted_sub_ca.pem",
  },
];

await mkdir(certDir, { recursive: true });

for (const source of sources) {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(
      `Не удалось скачать ${source.file}: HTTP ${response.status}. ` +
        "Скачай сертификаты вручную с https://www.gosuslugi.ru/crt",
    );
  }
  const body = await response.text();
  await writeFile(path.join(certDir, source.file), body, "utf8");
  console.log(`Saved ${source.file}`);
}

console.log("Готово. Пересобери приложение: npm run tauri build");
