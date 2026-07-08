type ProactiveRuntimeModule = typeof import("./proactiveRuntime");
type LiveToolsModule = typeof import("../tools/liveTools");
type SafeActionsModule = typeof import("../tools/safeActions");
type VisionClientModule = typeof import("../llm/visionClient");
type ScreenCaptureModule = typeof import("../platform/screenCapture");
type RagClientModule = typeof import("../rag/ragClient");

let proactiveRuntimePromise: Promise<ProactiveRuntimeModule> | null = null;
let liveToolsPromise: Promise<LiveToolsModule> | null = null;
let safeActionsPromise: Promise<SafeActionsModule> | null = null;
let visionClientPromise: Promise<VisionClientModule> | null = null;
let screenCapturePromise: Promise<ScreenCaptureModule> | null = null;
let ragClientPromise: Promise<RagClientModule> | null = null;

export function loadProactiveRuntime(): Promise<ProactiveRuntimeModule> {
  proactiveRuntimePromise ??= import("./proactiveRuntime");
  return proactiveRuntimePromise;
}

export function loadLiveTools(): Promise<LiveToolsModule> {
  liveToolsPromise ??= import("../tools/liveTools");
  return liveToolsPromise;
}

export function loadSafeActions(): Promise<SafeActionsModule> {
  safeActionsPromise ??= import("../tools/safeActions");
  return safeActionsPromise;
}

export function loadVisionClient(): Promise<VisionClientModule> {
  visionClientPromise ??= import("../llm/visionClient");
  return visionClientPromise;
}

export function loadScreenCapture(): Promise<ScreenCaptureModule> {
  screenCapturePromise ??= import("../platform/screenCapture");
  return screenCapturePromise;
}

export function loadRagClient(): Promise<RagClientModule> {
  ragClientPromise ??= import("../rag/ragClient");
  return ragClientPromise;
}
