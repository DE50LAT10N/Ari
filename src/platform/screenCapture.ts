import { invoke } from "@tauri-apps/api/core";

export type ScreenCapture = {
  imageBase64: string;
  title: string;
  processName: string;
  width: number;
  height: number;
};

export function captureActiveWindow(): Promise<ScreenCapture> {
  return invoke<ScreenCapture>("capture_active_window");
}

export async function cropScreenCapture(
  capture: ScreenCapture,
  selection: { x: number; y: number; width: number; height: number },
): Promise<ScreenCapture> {
  const image = new Image();
  image.src = `data:image/png;base64,${capture.imageBase64}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Не удалось открыть снимок."));
  });

  const x = Math.max(0, Math.round(selection.x * image.naturalWidth));
  const y = Math.max(0, Math.round(selection.y * image.naturalHeight));
  const width = Math.min(
    image.naturalWidth - x,
    Math.max(32, Math.round(selection.width * image.naturalWidth)),
  );
  const height = Math.min(
    image.naturalHeight - y,
    Math.max(32, Math.round(selection.height * image.naturalHeight)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas недоступен.");
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  const imageBase64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
  capture.imageBase64 = "";
  return { ...capture, imageBase64, width, height };
}
