import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import {
  availableMonitors,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { logError } from "../platform/logger";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const LAYOUT_KEY = "desktop-character.window-layout.v1";
const LEGACY_POSITION_KEY = "desktop-character.window-position.v1";
const WINDOW_MARGIN = 12;

export const WINDOW_MIN_WIDTH = 400;
export const WINDOW_MIN_HEIGHT = 560;
export const WINDOW_DEFAULT_WIDTH = 460;
export const WINDOW_DEFAULT_HEIGHT = 720;

type StoredLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function readStoredLayout(): StoredLayout | null {
  try {
    const value = localStorage.getItem(LAYOUT_KEY);
    if (value) {
      const parsed = JSON.parse(value) as Partial<StoredLayout>;
      if (
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        typeof parsed.width === "number" &&
        typeof parsed.height === "number"
      ) {
        return {
          x: parsed.x,
          y: parsed.y,
          width: Math.max(WINDOW_MIN_WIDTH, parsed.width),
          height: Math.max(WINDOW_MIN_HEIGHT, parsed.height),
        };
      }
    }

    const legacy = localStorage.getItem(LEGACY_POSITION_KEY);
    if (legacy) {
      const position = JSON.parse(legacy) as { x?: number; y?: number };
      if (typeof position.x === "number" && typeof position.y === "number") {
        return {
          x: position.x,
          y: position.y,
          width: WINDOW_DEFAULT_WIDTH,
          height: WINDOW_DEFAULT_HEIGHT,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function saveLayout(layout: StoredLayout): void {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

function isLayoutVisible(
  layout: StoredLayout,
  monitors: Awaited<ReturnType<typeof availableMonitors>>,
): boolean {
  return monitors.some(({ workArea }) => {
    const left = workArea.position.x;
    const top = workArea.position.y;
    const right = left + workArea.size.width;
    const bottom = top + workArea.size.height;

    return (
      layout.x < right - 80 &&
      layout.y < bottom - 80 &&
      layout.x > left - layout.width + 80 &&
      layout.y > top - layout.height + 80
    );
  });
}

export async function restoreWindowLayout(): Promise<() => void> {
  const appWindow = getCurrentWindow();
  const monitors = await availableMonitors();
  const stored = readStoredLayout();

  if (stored) {
    await appWindow.setSize(
      new PhysicalSize(stored.width, stored.height),
    );
    if (isLayoutVisible(stored, monitors)) {
      await appWindow.setPosition(new PhysicalPosition(stored.x, stored.y));
    }
  }

  if (!stored || !isLayoutVisible(stored, monitors)) {
    const monitor = (await primaryMonitor()) ?? monitors[0];

    if (monitor) {
      const size = await appWindow.outerSize();
      const x =
        monitor.workArea.position.x +
        monitor.workArea.size.width -
        size.width -
        WINDOW_MARGIN;
      const y =
        monitor.workArea.position.y +
        monitor.workArea.size.height -
        size.height -
        WINDOW_MARGIN;

      await appWindow.setPosition(new PhysicalPosition(x, y));
    }
  }

  const snapshot = async () => {
    const [position, size] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);
    saveLayout({
      x: position.x,
      y: position.y,
      width: Math.max(WINDOW_MIN_WIDTH, size.width),
      height: Math.max(WINDOW_MIN_HEIGHT, size.height),
    });
  };

  void snapshot();

  const unlistenMove = await appWindow.onMoved(() => {
    void snapshot();
  });
  const unlistenResize = await appWindow.onResized(() => {
    void snapshot();
  });

  return () => {
    unlistenMove();
    unlistenResize();
  };
}

export async function startWindowDragging(): Promise<void> {
  await getCurrentWindow().startDragging();
}

export async function startWindowResize(
  direction: ResizeDirection = "SouthWest",
): Promise<void> {
  try {
    await getCurrentWindow().startResizeDragging(direction);
  } catch (error) {
    logError("Failed to start window resize", error);
  }
}

export async function hideMainWindow(): Promise<void> {
  await getCurrentWindow().hide();
}
