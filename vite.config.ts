import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

// @ts-expect-error process is a nodejs global
const remoteHost = process.env.TAURI_DEV_HOST;
const host = remoteHost || "127.0.0.1";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pdfjs-dist")) {
            return "pdfjs";
          }
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-is/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react";
          }
          if (
            id.includes("/src/character/adviceEngine") ||
            id.includes("/src/character/proactiveLlmEngine") ||
            id.includes("/src/character/advisorEngine") ||
            id.includes("/src/character/advicePlanner") ||
            id.includes("/src/character/adviceLedger")
          ) {
            return "proactive-advice";
          }
          if (
            id.includes("/src/llm/") ||
            id.includes("/src/character/promptBuilder") ||
            id.includes("/src/character/replyPipeline")
          ) {
            return "chat-llm";
          }
          if (
            id.includes("/src/rag/") ||
            id.includes("/src/memory/ivf") ||
            id.includes("/src/memory/embedding")
          ) {
            return "memory-rag";
          }
          if (id.includes("node_modules/jszip")) {
            return "backup";
          }
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host,
    hmr: remoteHost
      ? {
          protocol: "ws",
          host: remoteHost,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
