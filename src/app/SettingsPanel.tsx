import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  checkOllamaStatus,
  isOllamaModelAvailable,
  loadOllamaModel,
  needsOllamaModelCatalog,
  unloadOllamaModel,
  type OllamaStatus,
} from "../llm/localLlmClient";
import {
  getAutostartEnabled,
  setAutostartEnabled,
} from "../platform/autostart";
import { startOllamaProcess } from "../platform/ollamaProcess";
import { restartOllama } from "../platform/ollamaEnvironment";
import { logError } from "../platform/logger";
import type { AppSettings } from "../settings/appSettings";
import { indexDocument, invalidateRagSearchIndex } from "../rag/ragClient";
import {
  clearRagChunks,
  getRagStats,
} from "../rag/ragStore";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import { AboutPanel } from "./AboutPanel";
import { OllamaModelPicker } from "./OllamaModelPicker";
import {
  GigaChatEmbeddingPicker,
  GigaChatModelPicker,
} from "./GigaChatModelPicker";
import {
  GIGA_CHAT_CHAT_MODELS,
  GIGA_CHAT_VISION_MODELS,
  syncGigaChatModelSelection,
} from "../llm/gigaChatModels";
import { resolveModel } from "../llm/modelRouter";
import { getUserMemoryStats } from "../memory/userMemory";
import { getMemoryHealthSnapshot } from "../memory/memoryTelemetry";
import { getRetrievalHealthSnapshot } from "../memory/retrievalTelemetry";
import { invalidateMemorySemanticCache } from "../memory/memorySemanticIndex";
import { clearStoredIvfIndex } from "../memory/ivfStore";
import { clearEmbeddingQueryCache } from "../llm/embeddingCache";
import { consolidateUserMemory } from "../memory/memoryConsolidator";
import { analyzeScreenCapture } from "../llm/visionClient";
import {
  ensureProactiveClockStarted,
  getLastAdviceAttemptAt,
  getLastSmalltalkAttemptAt,
} from "../character/proactiveState";
import {
  proactiveAdviceIntervalMs,
  proactiveSmalltalkIntervalMs,
} from "../character/initiativeConfig";
import { isQuietHours } from "../character/reminders";
import { deriveLifecycleState } from "../character/lifecycle";
import {
  allowsInitiativeForKind,
  deriveInterruptibility,
  describeInterruptibility,
} from "../character/interruptibility";
import {
  clearSafeActionLog,
  loadSafeActionLog,
  type SafeActionLogEntry,
} from "../tools/safeActions";
import {
  deleteGigaChatAuthKey,
  loadGigaChatAuthKey,
  saveGigaChatAuthKey,
} from "../platform/gigaChatCredentials";
import {
  checkGigaChatStatus,
  clearGigaChatTokenCache,
} from "../llm/gigaChatClient";
import {
  getEmbeddingSource,
  isEmbeddingSourceConfigured,
} from "../llm/embeddingConfig";
import { getVisionSource } from "../llm/visionConfig";
import {
  isQuietModeActive,
  quietModeLabel,
} from "../character/quietMode";
import {
  backupBeforeUpdate,
  exportAriData,
  importAriData,
  resetAllLocalData,
  resetOnlyMemory,
  resetOnlyRag,
  resetRelationshipAndMood,
} from "../platform/dataBackup";
import {
  loadPreferenceRules,
  removePreferenceRule,
  updatePreferenceRule,
} from "../memory/userPreferenceRules";
import {
  loadScenarioPacks,
  setScenarioPackEnabled,
} from "../character/scenarioPacks";
import { BlipVoiceSettingsPanel } from "./BlipVoiceSettingsPanel";

const MemoryPanel = lazy(() =>
  import("./MemoryPanel").then((module) => ({ default: module.MemoryPanel })),
);
const ProjectBinderPanel = lazy(() =>
  import("./ProjectBinderPanel").then((module) => ({
    default: module.ProjectBinderPanel,
  })),
);
import { AriDiagnosticsSection } from "./AriDiagnosticsSection";
import { ProactiveLabSection } from "./ProactiveLabSection";
import { SettingsCategory } from "./SettingsCategory";
import {
  loadOpenCategories,
  saveOpenCategories,
  type SettingsCategoryId,
} from "./settingsCategoryIds";
import { delay } from "../platform/asyncTimeout";

type SettingsPanelProps = {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  activeWindow: ActiveWindowInfo | null;
  openSubpanel?: "diagnostics" | null;
};

function formatBytes(bytes: number): string {
  return bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "—";
}

function invalidateEmbeddingIndexes(): void {
  clearEmbeddingQueryCache();
  invalidateMemorySemanticCache();
  invalidateRagSearchIndex();
  void clearStoredIvfIndex();
}

function applyEmbeddingSettingsChange(
  settings: AppSettings,
  onChange: (settings: AppSettings) => void,
  patch: Partial<AppSettings>,
): void {
  const embeddingTouched =
    (patch.embeddingModel !== undefined &&
      patch.embeddingModel !== settings.embeddingModel) ||
    (patch.embeddingSource !== undefined &&
      patch.embeddingSource !== settings.embeddingSource) ||
    (patch.gigaChatEmbeddingModel !== undefined &&
      patch.gigaChatEmbeddingModel !== settings.gigaChatEmbeddingModel);
  if (embeddingTouched) {
    invalidateEmbeddingIndexes();
  }
  onChange({ ...settings, ...patch });
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  activeWindow,
  openSubpanel = null,
}: SettingsPanelProps) {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [modelOperation, setModelOperation] = useState<
    "load" | "unload" | "start" | null
  >(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [autostartEnabled, setAutostartState] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [projectBinderOpen, setProjectBinderOpen] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [proactiveLabExpanded, setProactiveLabExpanded] = useState(false);
  const [scenarioPacks, setScenarioPacks] = useState(loadScenarioPacks);
  const [preferenceRules, setPreferenceRules] = useState(loadPreferenceRules);
  const [memoryStats, setMemoryStats] = useState({
    facts: 0,
    activeFacts: 0,
    summaries: 0,
  });
  const [memoryHealth, setMemoryHealth] = useState(getMemoryHealthSnapshot);
  const [retrievalHealth, setRetrievalHealth] = useState(getRetrievalHealthSnapshot);
  const [proactiveStatus, setProactiveStatus] = useState("");
  const [ragStats, setRagStats] = useState({ chunks: 0, sources: 0 });
  const [ragBusy, setRagBusy] = useState(false);
  const [ragMessage, setRagMessage] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<SafeActionLogEntry[]>(
    loadSafeActionLog,
  );
  const [gigaChatKey, setGigaChatKey] = useState("");
  const [gigaChatKeySaved, setGigaChatKeySaved] = useState(false);
  const [gigaChatOnline, setGigaChatOnline] = useState<boolean | null>(null);
  const [gigaChatBusy, setGigaChatBusy] = useState(false);
  const [gigaChatMessage, setGigaChatMessage] = useState<string | null>(null);
  const [modelsRefreshing, setModelsRefreshing] = useState(false);
  const [openCategories, setOpenCategories] = useState(loadOpenCategories);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleCategory(id: SettingsCategoryId) {
    setOpenCategories((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveOpenCategories(next);
      return next;
    });
  }

  function isCategoryOpen(id: SettingsCategoryId): boolean {
    return openCategories.has(id);
  }
  const showOllamaModelCatalog = needsOllamaModelCatalog(settings);
  const providerReady =
    settings.llmProvider === "gigachat"
      ? gigaChatOnline === true
      : Boolean(status?.online);
  const embeddingSource = getEmbeddingSource(settings);
  const visionSource = getVisionSource(settings);
  const ragEmbeddingReady =
    embeddingSource === "none"
      ? false
      : embeddingSource === "ollama"
        ? Boolean(status?.online)
        : gigaChatOnline === true;

  useEffect(() => {
    if (openSubpanel === "diagnostics") {
      setDiagnosticsExpanded(true);
      setOpenCategories((previous) => {
        const next = new Set(previous);
        next.add("tasks");
        saveOpenCategories(next);
        return next;
      });
    }
  }, [openSubpanel]);

  async function refreshRagStats() {
    setRagStats(await getRagStats());
  }

  async function importKnowledge(files: FileList | null) {
    if (!files?.length) {
      return;
    }
    if (!isEmbeddingSourceConfigured(settings)) {
      setRagMessage(
        "Embeddings отключены. Выбери GigaChat API или Ollama в настройках RAG.",
      );
      return;
    }
    if (!ragEmbeddingReady) {
      setRagMessage(
        embeddingSource === "ollama"
          ? "Ollama недоступна. Запусти её для локальных embeddings."
          : "GigaChat недоступен для embeddings.",
      );
      return;
    }

    setRagBusy(true);
    setRagMessage(null);
    try {
      let importedChunks = 0;
      for (const file of Array.from(files)) {
        if (
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
        ) {
          const { extractPdfPagesWithOcr } = await import(
            "../rag/pdfTextExtractor"
          );
          const pages = await extractPdfPagesWithOcr(
            file,
            async (page) =>
              analyzeScreenCapture(
                {
                  imageBase64: page.imageBase64,
                  title: `${file.name}, страница ${page.pageNumber}`,
                  processName: "PDF OCR",
                  width: page.width,
                  height: page.height,
                },
                "Выполни OCR страницы документа. Верни весь читаемый текст в естественном порядке, сохрани заголовки и абзацы. Не комментируй документ.",
                settings,
              ),
          );
          for (const page of pages) {
            importedChunks += await indexDocument(
              `${file.name} — стр. ${page.pageNumber}`,
              page.text,
              settings,
            );
          }
        } else if (
          file.type.startsWith("image/") ||
          /\.(png|jpe?g|webp)$/i.test(file.name)
        ) {
          const imageBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(String(reader.result).split(",")[1] ?? "");
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          const text = await analyzeScreenCapture(
            {
              imageBase64,
              title: file.name,
              processName: "Image OCR",
              width: 0,
              height: 0,
            },
            "Выполни OCR изображения. Верни весь важный читаемый текст в естественном порядке. Если это схема или интерфейс, кратко опиши структуру после текста.",
            settings,
          );
          importedChunks += await indexDocument(file.name, text, settings);
        } else {
          importedChunks += await indexDocument(
            file.name,
            await file.text(),
            settings,
          );
        }
      }
      await refreshRagStats();
      setRagMessage(`Добавлено фрагментов: ${importedChunks}.`);
    } catch (error) {
      setRagMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRagBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function clearKnowledge() {
    setRagBusy(true);
    await clearRagChunks();
    await refreshRagStats();
    setRagMessage("Локальная база знаний очищена.");
    setRagBusy(false);
  }

  async function refreshOllamaModels() {
    setModelsRefreshing(true);
    try {
      const nextStatus = await checkOllamaStatus(settings.ollamaBaseUrl);
      setStatus(nextStatus);
      if (!nextStatus.online && nextStatus.error) {
        setOperationError(nextStatus.error);
      }
    } finally {
      setModelsRefreshing(false);
    }
  }

  async function applyOllamaModelsAndRestart() {
    const modelsDir = settings.ollamaModelsDir.trim();
    if (!modelsDir) {
      setOperationError("Укажи папку моделей Ollama.");
      return;
    }

    setModelsRefreshing(true);
    setOperationError(null);
    try {
      const message = await restartOllama(modelsDir);
      await delay(2000);
      await refreshOllamaModels();
      setRagMessage(message);
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setModelsRefreshing(false);
    }
  }

  async function refreshStatus() {
    if (settings.llmProvider === "gigachat") {
      setChecking(true);
      const key = await loadGigaChatAuthKey().catch(() => null);
      const hasKey = Boolean(key);
      setGigaChatKeySaved(hasKey);
      if (!hasKey) {
        setGigaChatOnline(false);
        setChecking(false);
        setOperationError(null);
        return null;
      }
      const nextStatus = await checkGigaChatStatus(settings);
      setChecking(false);
      setGigaChatOnline(nextStatus.online);
      setOperationError(nextStatus.error ?? null);
      if (!nextStatus.online && nextStatus.error) {
        setGigaChatMessage(nextStatus.error);
      } else if (nextStatus.online) {
        setGigaChatMessage(null);
      }
      if (needsOllamaModelCatalog(settings)) {
        const ollamaStatus = await checkOllamaStatus(settings.ollamaBaseUrl);
        setStatus(ollamaStatus);
      } else {
        setStatus(null);
      }
      return null;
    }
    setChecking(true);
    const nextStatus = await checkOllamaStatus(settings.ollamaBaseUrl);
    setStatus(nextStatus);
    setChecking(false);
    return nextStatus;
  }

  async function saveGigaChatKey() {
    if (!gigaChatKey.trim()) return;
    setGigaChatBusy(true);
    setGigaChatMessage(null);
    try {
      await saveGigaChatAuthKey(gigaChatKey);
      clearGigaChatTokenCache();
      setGigaChatKey("");
      setGigaChatKeySaved(true);
      const result = await checkGigaChatStatus(settings);
      setGigaChatOnline(result.online);
      setGigaChatMessage(
        result.online
          ? "Ключ сохранён, GigaChat доступен."
          : result.error ?? "GigaChat недоступен.",
      );
    } catch (error) {
      setGigaChatMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setGigaChatBusy(false);
    }
  }

  async function removeGigaChatKey() {
    setGigaChatBusy(true);
    await deleteGigaChatAuthKey();
    clearGigaChatTokenCache();
    setGigaChatKey("");
    setGigaChatKeySaved(false);
    setGigaChatOnline(false);
    setGigaChatMessage("Ключ удалён.");
    setGigaChatBusy(false);
  }

  async function startOllama() {
    setModelOperation("start");
    setOperationError(null);

    try {
      await startOllamaProcess();

      for (let attempt = 0; attempt < 15; attempt += 1) {
        await delay(700);
        const nextStatus = await checkOllamaStatus(settings.ollamaBaseUrl);
        setStatus(nextStatus);
        if (nextStatus.online) {
          return;
        }
      }

      throw new Error("Ollama запущена, но API не ответил вовремя.");
    } catch (error) {
      logError("Failed to start Ollama from settings", error);
      setOperationError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setModelOperation(null);
    }
  }

  async function toggleModel() {
    const isLoaded = status?.runningModels.some(({ name }) =>
      isOllamaModelAvailable(settings.model, [name]),
    );
    setModelOperation(isLoaded ? "unload" : "load");
    setOperationError(null);

    try {
      if (isLoaded) {
        await unloadOllamaModel(settings.ollamaBaseUrl, settings.model);
      } else {
        await loadOllamaModel(
          settings.ollamaBaseUrl,
          settings.model,
          settings.contextTokens,
        );
      }
      await refreshStatus();
    } catch (error) {
      logError("Failed to change Ollama model state", error);
      setOperationError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setModelOperation(null);
    }
  }

  async function toggleAutostart() {
    const nextValue = !autostartEnabled;
    setAutostartLoading(true);
    setAutostartError(null);

    try {
      await setAutostartEnabled(nextValue);
      setAutostartState(await getAutostartEnabled());
    } catch (error) {
      logError("Failed to change Windows autostart", error);
      setAutostartError(
        error instanceof Error
          ? error.message
          : "Не удалось изменить автозапуск.",
      );
    } finally {
      setAutostartLoading(false);
    }
  }

  useEffect(() => {
    void loadGigaChatAuthKey()
      .then((key) => {
        setGigaChatKeySaved(Boolean(key));
        return refreshStatus();
      })
      .catch(() => {
        setGigaChatKeySaved(false);
        return refreshStatus();
      });
    const statusPollMs =
      settings.llmProvider === "gigachat" && !needsOllamaModelCatalog(settings)
        ? 120_000
        : 10_000;
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, statusPollMs);

    if (needsOllamaModelCatalog(settings)) {
      void refreshOllamaModels();
    }

    void getAutostartEnabled()
      .then(setAutostartState)
      .catch((error: unknown) => {
        setAutostartError(
          error instanceof Error
            ? error.message
            : "Не удалось проверить автозапуск.",
        );
      })
      .finally(() => setAutostartLoading(false));
    void refreshRagStats();
    const refreshMemoryCount = () => {
      void getUserMemoryStats().then(setMemoryStats);
      setMemoryHealth(getMemoryHealthSnapshot());
      setRetrievalHealth(getRetrievalHealthSnapshot());
    };
    window.addEventListener("ari-memory-changed", refreshMemoryCount);
    window.addEventListener("ari-memory-inbox-changed", refreshMemoryCount);
    const refreshActionLog = () => setActionLog(loadSafeActionLog());
    window.addEventListener(
      "ari-safe-action-log-changed",
      refreshActionLog,
    );
    refreshMemoryCount();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(
        "ari-memory-changed",
        refreshMemoryCount,
      );
      window.removeEventListener(
        "ari-memory-inbox-changed",
        refreshMemoryCount,
      );
      window.removeEventListener(
        "ari-safe-action-log-changed",
        refreshActionLog,
      );
    };
  }, [
    settings.llmProvider,
    settings.embeddingSource,
    settings.visionSource,
    settings.ollamaBaseUrl,
    settings.ollamaModelsDir,
  ]);

  useEffect(() => {
    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    );
    focusTarget?.focus();
  }, [aboutOpen, memoryOpen, projectBinderOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (aboutOpen) {
        setAboutOpen(false);
        return;
      }
      if (memoryOpen) {
        setMemoryOpen(false);
        return;
      }
      if (projectBinderOpen) {
        setProjectBinderOpen(false);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aboutOpen, memoryOpen, projectBinderOpen, onClose]);

  useEffect(() => {
    if (!settings.proactiveEnabled) {
      setProactiveStatus("Инициативность выключена.");
      return;
    }

    ensureProactiveClockStarted();
    const updateStatus = () => {
      if (!providerReady) {
        setProactiveStatus("Инициативы ждут доступный LLM-провайдер.");
        return;
      }
      if (isQuietModeActive(settings, activeWindow)) {
        setProactiveStatus("Инициативы сейчас блокирует режим тишины.");
        return;
      }
      if (isQuietHours(settings)) {
        setProactiveStatus("Инициативы сейчас блокируют тихие часы.");
        return;
      }
      const lifecycle = deriveLifecycleState(
        0,
        new Date().getHours(),
        settings.quietMode,
        isQuietModeActive(settings, activeWindow),
        settings.nightBehavior,
      );
      const interruptibility = deriveInterruptibility({
        lifecycle,
        focusSessionActive: false,
        bodyDoubling: false,
        pomodoroPhase: "idle",
        chatOpen: false,
        generationInProgress: false,
        quietModeActive: isQuietModeActive(settings, activeWindow),
        typingIdleSeconds: 999,
        recentIgnoredInitiatives: 0,
      });
      if (!allowsInitiativeForKind(interruptibility, "check_in")) {
        setProactiveStatus(
          `Check-in блокирует ${describeInterruptibility(interruptibility)} (lifecycle: ${lifecycle}).` +
            (settings.nightBehavior === "quiet"
              ? " Ночное поведение = «тихий» — переключи на «обычный», если тестируешь ночью."
              : " Проверь фокус-сессию или помодоро."),
        );
        return;
      }

      const adviceIntervalMs = proactiveAdviceIntervalMs(settings);
      const smalltalkIntervalMs = proactiveSmalltalkIntervalMs(settings);
      ensureProactiveClockStarted(adviceIntervalMs, smalltalkIntervalMs);
      const adviceRemaining = Math.max(
        0,
        adviceIntervalMs - (Date.now() - getLastAdviceAttemptAt()),
      );
      const smalltalkRemaining = Math.max(
        0,
        smalltalkIntervalMs - (Date.now() - getLastSmalltalkAttemptAt()),
      );
      const contextHint = settings.activityTrackingEnabled
        ? settings.autoVisionEnabled
          ? ""
          : " Авто-взгляд выключен; советы используют окно, буфер, память и историю."
        : " Контекст активного окна выключен, поэтому советы будут заметно беднее.";
      setProactiveStatus(
        adviceRemaining === 0 || smalltalkRemaining === 0
          ? `Ближайшая проверка готова: смолток ${smalltalkRemaining === 0 ? "сейчас" : `${Math.max(1, Math.ceil(smalltalkRemaining / 60_000))} мин`}, совет ${adviceRemaining === 0 ? "сейчас" : `${Math.max(1, Math.ceil(adviceRemaining / 60_000))} мин`}.${contextHint}`
          : `До смолтока: ${Math.max(
              1,
              Math.ceil(smalltalkRemaining / 60_000),
            )} мин · до совета: ${Math.max(
              1,
              Math.ceil(adviceRemaining / 60_000),
            )} мин.${contextHint}`,
      );
    };

    updateStatus();
    const timer = window.setInterval(updateStatus, 1000);
    window.addEventListener("ari-proactive-state-changed", updateStatus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(
        "ari-proactive-state-changed",
        updateStatus,
      );
    };
  }, [
    settings.proactiveEnabled,
    settings.proactiveAdviceIntervalMinutes,
    settings.proactiveSmalltalkIntervalMinutes,
    settings.initiativeLevel,
    settings.activityTrackingEnabled,
    settings.autoVisionEnabled,
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.quietMode,
    settings.quietModeUntil,
    settings.quietModeProcess,
    settings.nightBehavior,
    activeWindow,
    providerReady,
  ]);

  useEffect(() => {
    if (
      !settings.userMemoryEnabled ||
      !providerReady ||
      memoryStats.activeFacts < 100
    ) {
      return;
    }

    void consolidateUserMemory(settings).catch((error: unknown) => {
      logError("Automatic memory consolidation failed", error);
    });
  }, [
    memoryStats.activeFacts,
    settings.userMemoryEnabled,
    settings.model,
    settings.gigaChatModel,
    settings.llmProvider,
    settings.ollamaBaseUrl,
    providerReady,
  ]);

  const runningModel = status?.runningModels.find(({ name }) =>
    isOllamaModelAvailable(settings.model, [name]),
  );
  const busy = modelOperation !== null;

  const panelFallback = (
    <div
      className="settings-panel app-panel-surface open"
      role="dialog"
      aria-modal="true"
      aria-label="Настройки Ari"
    >
      Загрузка…
    </div>
  );

  if (aboutOpen) {
    return <AboutPanel onBack={() => setAboutOpen(false)} />;
  }

  if (memoryOpen) {
    return (
      <Suspense fallback={panelFallback}>
        <MemoryPanel onBack={() => setMemoryOpen(false)} />
      </Suspense>
    );
  }

  if (projectBinderOpen) {
    return (
      <Suspense fallback={panelFallback}>
        <ProjectBinderPanel onBack={() => setProjectBinderOpen(false)} />
      </Suspense>
    );
  }

  return (
    <div
      ref={panelRef}
      className="settings-panel app-panel-surface open"
      role="dialog"
      aria-modal="true"
      aria-label="Настройки Ari"
    >
      <div className="settings-title-row">
        <div>
          <strong>Настройки Ari</strong>
          <span
            className={`server-status ${providerReady ? "online" : "offline"}`}
          >
            {checking
              ? "проверка…"
              : settings.llmProvider === "gigachat"
                ? !gigaChatKeySaved
                  ? "ключ не задан"
                  : gigaChatOnline
                    ? "GigaChat доступен"
                    : gigaChatOnline === false
                      ? "GigaChat недоступен"
                      : "проверка…"
                : status?.online
                  ? `Ollama ${status.version ?? ""}`
                  : "сервер недоступен"}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть настройки">
          ×
        </button>
      </div>

      <div className="settings-categories">
        <SettingsCategory
          id="provider"
          title="Провайдер и модели"
          description="LLM, vision, embeddings, температура и контекст"
          badge={providerReady ? "online" : undefined}
          expanded={isCategoryOpen("provider")}
          onToggle={toggleCategory}
        >
      <div className="provider-selector">
        <button
          type="button"
          className={settings.llmProvider === "ollama" ? "active" : ""}
          onClick={() => onChange({ ...settings, llmProvider: "ollama" })}
        >
          Локальная Ollama
        </button>
        <button
          type="button"
          className={settings.llmProvider === "gigachat" ? "active" : ""}
          onClick={() => onChange({ ...settings, llmProvider: "gigachat" })}
        >
          GigaChat API
        </button>
      </div>

      {settings.llmProvider === "gigachat" && (
        <div className="settings-section-card">
          <label className="settings-field">
            <span>Ключ авторизации GigaChat</span>
            <input
              type="password"
              value={gigaChatKey}
              placeholder={
                gigaChatKeySaved ? "Ключ уже сохранён" : "Base64 Authorization key"
              }
              autoComplete="off"
              onChange={(event) => setGigaChatKey(event.currentTarget.value)}
            />
          </label>
          <div className="settings-inline-actions">
            <button
              className="settings-action-button primary"
              type="button"
              disabled={gigaChatBusy || !gigaChatKey.trim()}
              onClick={() => void saveGigaChatKey()}
            >
              Сохранить ключ
            </button>
            <button
              className="settings-action-button"
              type="button"
              disabled={gigaChatBusy || !gigaChatKeySaved}
              onClick={() => void removeGigaChatKey()}
            >
              Удалить
            </button>
          </div>
          <label className="settings-field">
            <span>Модель чата</span>
            <GigaChatModelPicker
              value={settings.gigaChatModel}
              options={GIGA_CHAT_CHAT_MODELS}
              onChange={(gigaChatModel) =>
                onChange(syncGigaChatModelSelection(settings, gigaChatModel))
              }
            />
            <span className="settings-note">
              Фактически для JSON/инициативы:{" "}
              {resolveModel("json", settings)}
            </span>
          </label>
          <label className="settings-field">
            <span>JSON / инициатива (synthesis, gate)</span>
            <GigaChatModelPicker
              value={settings.fastJsonModel ?? ""}
              options={GIGA_CHAT_CHAT_MODELS}
              allowEmpty
              emptyLabel="как модель чата"
              onChange={(fastJsonModel) =>
                onChange({
                  ...settings,
                  fastJsonModel: fastJsonModel || undefined,
                })
              }
            />
          </label>
          <label className="settings-field">
            <span>Scope проекта</span>
            <select
              value={settings.gigaChatScope}
              onChange={(event) =>
                onChange({
                  ...settings,
                  gigaChatScope: event.currentTarget
                    .value as AppSettings["gigaChatScope"],
                })
              }
            >
              <option value="GIGACHAT_API_PERS">Физлицо — PERS</option>
              <option value="GIGACHAT_API_B2B">Бизнес — B2B</option>
              <option value="GIGACHAT_API_CORP">Pay-as-you-go — CORP</option>
            </select>
          </label>
          <span className="settings-note">
            Для проактивных реплик выбери <strong>GigaChat 2 Pro</strong> или{" "}
            <strong>Max</strong>. Lite подписка часто заканчивается раньше —
            смотри баланс в личном кабинете Sber.
          </span>
          <span className="settings-note">
            Scope должен совпадать с типом ключа: PERS / B2B / CORP.
          </span>
          <span className="settings-note">
            Ключ авторизации шифруется Windows DPAPI и не
            сохраняется в localStorage.
          </span>
          <span className="settings-note">
            В этом режиме сообщения, выбранный контекст памяти/RAG, снимки и
            фоновые задачи Ari отправляются в GigaChat API. Vision и embeddings
            можно перевести на локальную Ollama в блоке ниже.
            Инициатива, извлечение памяти и OCR также расходуют API-токены.
          </span>
          <span className="settings-note">
            Для TLS нужен корневой сертификат НУЦ Минцифры: установи с{" "}
            <a href="https://www.gosuslugi.ru/crt" target="_blank" rel="noreferrer">
              gosuslugi.ru/crt
            </a>{" "}
            или выполни <code>npm run fetch-gigachat-certs</code> и пересобери приложение.
          </span>
          {gigaChatMessage && (
            <span
              className={`settings-note${
                gigaChatOnline === false ? " settings-error" : ""
              }`}
            >
              {gigaChatMessage}
            </span>
          )}
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void refreshStatus()}
            disabled={gigaChatBusy || checking || !gigaChatKeySaved}
          >
            {checking ? "Проверяю…" : "Проверить подключение"}
          </button>
        </div>
      )}

      {settings.llmProvider === "gigachat" && (
        <div className="settings-section-card">
          <div className="settings-section-heading">
            <div>
              <strong>Vision и embeddings</strong>
              <span>
                Чат остаётся в GigaChat. Компьютерное зрение и RAG-векторы можно
                вести через локальную Ollama.
              </span>
            </div>
          </div>

          <label className="settings-field">
            <span>Источник vision (кнопка «глаз», OCR, авто-взгляд)</span>
            <select
              value={settings.visionSource}
              onChange={(event) =>
                onChange({
                  ...settings,
                  visionSource: event.currentTarget
                    .value as AppSettings["visionSource"],
                })
              }
            >
              <option value="gigachat">GigaChat API</option>
              <option value="ollama">Локально через Ollama</option>
            </select>
          </label>
          {visionSource === "gigachat" ? (
            <label className="settings-field">
              <span>Vision-модель GigaChat</span>
              <GigaChatModelPicker
                value={settings.gigaChatVisionModel}
                options={GIGA_CHAT_VISION_MODELS}
                onChange={(gigaChatVisionModel) =>
                  onChange({
                    ...settings,
                    gigaChatVisionModel,
                  })
                }
              />
            </label>
          ) : (
            <label className="settings-field">
              <span>Локальная vision-модель (Ollama)</span>
              <OllamaModelPicker
                value={settings.visionModel}
                models={showOllamaModelCatalog ? (status?.models ?? []) : []}
                placeholder="qwen2.5vl:7b"
                onChange={(visionModel) =>
                  onChange({ ...settings, visionModel })
                }
              />
            </label>
          )}

          <label className="settings-field">
            <span>Источник embeddings (RAG)</span>
            <select
              value={settings.embeddingSource}
              onChange={(event) => {
                const nextEmbeddingSource = event.currentTarget
                  .value as AppSettings["embeddingSource"];
                applyEmbeddingSettingsChange(settings, onChange, {
                  embeddingSource: nextEmbeddingSource,
                  ragEnabled:
                    nextEmbeddingSource === "none"
                      ? false
                      : settings.ragEnabled,
                });
              }}
            >
              <option value="gigachat">GigaChat API</option>
              <option value="ollama">Локально через Ollama</option>
              <option value="none">Без embeddings</option>
            </select>
          </label>
          {isEmbeddingSourceConfigured(settings) && (
            <label className="settings-field">
              <span>Модель embeddings</span>
              {embeddingSource === "gigachat" ? (
                <GigaChatEmbeddingPicker
                  value={settings.gigaChatEmbeddingModel}
                  onChange={(gigaChatEmbeddingModel) =>
                    applyEmbeddingSettingsChange(settings, onChange, {
                      gigaChatEmbeddingModel,
                    })
                  }
                />
              ) : (
                <OllamaModelPicker
                  value={settings.embeddingModel}
                  models={
                    showOllamaModelCatalog ? (status?.models ?? []) : []
                  }
                  onChange={(embeddingModel) =>
                    applyEmbeddingSettingsChange(settings, onChange, {
                      embeddingModel,
                    })
                  }
                />
              )}
            </label>
          )}

          {showOllamaModelCatalog && (
            <>
              <label className="settings-field">
                <span>URL Ollama</span>
                <input
                  value={settings.ollamaBaseUrl}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      ollamaBaseUrl: event.currentTarget.value,
                    })
                  }
                />
              </label>
              {!status?.online && (
                <button
                  className="settings-action-button primary"
                  type="button"
                  onClick={() => void startOllama()}
                  disabled={busy}
                >
                  {modelOperation === "start"
                    ? "Запускаю Ollama…"
                    : "Запустить Ollama"}
                </button>
              )}
              <label className="settings-field">
                <span>Папка моделей Ollama</span>
                <input
                  value={settings.ollamaModelsDir}
                  placeholder="<OLLAMA_MODELS_DIR>"
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      ollamaModelsDir: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <div className="settings-inline-actions">
                <button
                  className="settings-action-button"
                  type="button"
                  onClick={() => void refreshOllamaModels()}
                  disabled={modelsRefreshing}
                >
                  {modelsRefreshing
                    ? "Обновляю…"
                    : `Список моделей Ollama (${status?.models.length ?? 0})`}
                </button>
                {settings.ollamaModelsDir.trim() && (
                  <button
                    className="settings-action-button primary"
                    type="button"
                    onClick={() => void applyOllamaModelsAndRestart()}
                    disabled={modelsRefreshing || busy}
                  >
                    {modelsRefreshing
                      ? "Применяю…"
                      : "Применить папку и перезапустить Ollama"}
                  </button>
                )}
              </div>
              {status && !status.online && (
                <span className="settings-note settings-error">
                  Ollama недоступна{status.error ? `: ${status.error}` : ""}
                </span>
              )}
              <span className="settings-note">
                Для vision: <code>ollama pull qwen2.5vl:7b</code>. Для
                embeddings: <code>ollama pull embeddinggemma</code>.
              </span>
            </>
          )}
        </div>
      )}

      {settings.llmProvider === "ollama" && !status?.online && (
        <button
          className="settings-action-button primary"
          type="button"
          onClick={() => void startOllama()}
          disabled={busy}
        >
          {modelOperation === "start" ? "Запускаю Ollama…" : "Запустить Ollama"}
        </button>
      )}

      {settings.llmProvider === "ollama" && <label className="settings-field">
        <span>Адрес Ollama</span>
        <input
          value={settings.ollamaBaseUrl}
          onChange={(event) =>
            onChange({ ...settings, ollamaBaseUrl: event.currentTarget.value })
          }
        />
      </label>}

      {showOllamaModelCatalog && (
        <label className="settings-field">
          <span>Папка моделей Ollama</span>
          <input
            value={settings.ollamaModelsDir}
            placeholder="<OLLAMA_MODELS_DIR>"
            onChange={(event) =>
              onChange({
                ...settings,
                ollamaModelsDir: event.currentTarget.value,
              })
            }
          />
        </label>
      )}

      {showOllamaModelCatalog && (
        <span className="settings-note">
          Если в имени профиля Windows есть кириллица, укажи путь только латиницей.
          После смены папки скопируй сюда содержимое{" "}
          <code>%USERPROFILE%\.ollama\models</code> или заново скачай модели через{" "}
          <code>ollama pull</code>.
        </span>
      )}

      {settings.llmProvider === "ollama" && <label className="settings-field">
        <span>Модель</span>
        <OllamaModelPicker
          value={settings.model}
          models={showOllamaModelCatalog ? (status?.models ?? []) : []}
          onChange={(model) => onChange({ ...settings, model })}
        />
      </label>}

      {showOllamaModelCatalog && (
        <div className="settings-inline-actions">
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void refreshOllamaModels()}
            disabled={modelsRefreshing}
          >
            {modelsRefreshing
              ? "Обновляю список…"
              : `Обновить список моделей (${status?.models.length ?? 0})`}
          </button>
          {settings.ollamaModelsDir.trim() && (
            <button
              className="settings-action-button primary"
              type="button"
              onClick={() => void applyOllamaModelsAndRestart()}
              disabled={modelsRefreshing || busy}
            >
              {modelsRefreshing
                ? "Применяю…"
                : "Применить папку и перезапустить Ollama"}
            </button>
          )}
          {status && !status.online && (
            <span className="settings-note settings-error">
              Ollama недоступна{status.error ? `: ${status.error}` : ""}
            </span>
          )}
        </div>
      )}

      {settings.llmProvider === "ollama" && <label className="settings-field">
        <span>Vision-модель для кнопки «Посмотреть на экран»</span>
        <OllamaModelPicker
          value={settings.visionModel}
          models={showOllamaModelCatalog ? (status?.models ?? []) : []}
          placeholder="qwen2.5vl:7b"
          onChange={(visionModel) =>
            onChange({
              ...settings,
              visionModel,
            })
          }
        />
      </label>}

      <label className="settings-field">
        <span>Быстрая JSON-модель (initiative / validator)</span>
        {settings.llmProvider === "gigachat" ? (
          <span className="settings-note">
            Настраивается в блоке GigaChat API выше («JSON / инициатива»).
          </span>
        ) : (
          <OllamaModelPicker
            value={settings.fastJsonModel ?? ""}
            models={showOllamaModelCatalog ? (status?.models ?? []) : []}
            placeholder={settings.model}
            allowEmpty
            onChange={(fastJsonModel) =>
              onChange({
                ...settings,
                fastJsonModel: fastJsonModel || undefined,
              })
            }
          />
        )}
      </label>
      <label className="settings-field">
        <span>Модель памяти (extraction / summarization)</span>
        <OllamaModelPicker
          value={settings.memoryModel ?? ""}
          models={showOllamaModelCatalog ? (status?.models ?? []) : []}
          placeholder={settings.model}
          allowEmpty
          onChange={(memoryModel) =>
            onChange({
              ...settings,
              memoryModel: memoryModel || undefined,
            })
          }
        />
      </label>
      <NumberSetting
        label="Текстовая visual-память, минут"
        value={settings.visualMemoryMinutes}
        min={0}
        max={120}
        step={1}
        hint="Как долго Ari помнит текст последнего снимка экрана (0 — не помнить)."
        onChange={(visualMemoryMinutes) =>
          onChange({ ...settings, visualMemoryMinutes })
        }
      />

      {settings.llmProvider === "ollama" && status?.online && (
        <div className="model-runtime-card">
          <div>
            <span>Состояние</span>
            <strong>{runningModel ? "загружена в память" : "выгружена"}</strong>
          </div>
          <div>
            <span>VRAM</span>
            <strong>{formatBytes(runningModel?.sizeVram ?? 0)}</strong>
          </div>
          <div>
            <span>Контекст</span>
            <strong>
              {runningModel?.contextLength
                ? runningModel.contextLength.toLocaleString("ru-RU")
                : "—"}
            </strong>
          </div>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void toggleModel()}
            disabled={
              busy ||
              !isOllamaModelAvailable(
                settings.model,
                status?.models ?? [],
              )
            }
          >
            {modelOperation === "load"
              ? "Загрузка…"
              : modelOperation === "unload"
                ? "Выгрузка…"
                : runningModel
                  ? "Выгрузить модель"
                  : "Загрузить модель"}
          </button>
        </div>
      )}

      <div className="settings-grid">
        <NumberSetting
          label="Температура"
          value={settings.temperature}
          min={0}
          max={2}
          step={0.05}
          hint="Выше — живее и непредсказуемее; ниже — точнее и спокойнее."
          onChange={(temperature) => onChange({ ...settings, temperature })}
        />
        <NumberSetting
          label="Ответ, токены"
          value={settings.maxTokens}
          min={64}
          max={8192}
          step={64}
          hint="Максимальная длина одного ответа Ari."
          onChange={(maxTokens) => onChange({ ...settings, maxTokens })}
        />
        <NumberSetting
          label="Контекст"
          value={settings.contextTokens}
          min={2048}
          max={40960}
          step={1024}
          hint="Сколько токенов истории и памяти помещается в один запрос."
          onChange={(contextTokens) =>
            onChange({ ...settings, contextTokens })
          }
        />
      </div>
        </SettingsCategory>

        <SettingsCategory
          id="personality"
          title="Личность и поведение"
          description="Тон, правила и живая анимация аватара"
          expanded={isCategoryOpen("personality")}
          onToggle={toggleCategory}
        >

      <div className="settings-section-card">
        <strong>Персонализация</strong>
        <label className="settings-field">
          <span>Имя пользователя</span>
          <input
            value={settings.userName}
            onChange={(event) =>
              onChange({ ...settings, userName: event.currentTarget.value })
            }
          />
        </label>
        <label className="settings-field">
          <span>Оттенок тона Ari</span>
          <select
            value={settings.ariTone}
            onChange={(event) =>
              onChange({
                ...settings,
                ariTone: event.currentTarget.value as AppSettings["ariTone"],
              })
            }
          >
            <option value="balanced">Сбалансированный</option>
            <option value="softer">Мягче</option>
            <option value="sharper">Язвительнее</option>
            <option value="quieter">Тише</option>
            <option value="technical">Техничнее</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Подколы</span>
          <select
            value={settings.teasingLevel}
            onChange={(event) =>
              onChange({
                ...settings,
                teasingLevel: event.currentTarget
                  .value as AppSettings["teasingLevel"],
              })
            }
          >
            <option value="low">Слабые</option>
            <option value="normal">Обычные</option>
            <option value="high">Острые</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Теплота</span>
          <select
            value={settings.warmthLevel}
            onChange={(event) =>
              onChange({
                ...settings,
                warmthLevel: event.currentTarget
                  .value as AppSettings["warmthLevel"],
              })
            }
          >
            <option value="low">Сдержанная</option>
            <option value="normal">Обычная</option>
            <option value="high">Тёплая</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Инициатива</span>
          <select
            value={settings.initiativeLevel}
            onChange={(event) =>
              onChange({
                ...settings,
                initiativeLevel: event.currentTarget
                  .value as AppSettings["initiativeLevel"],
              })
            }
          >
            <option value="silent">Тихая</option>
            <option value="rare">Редкая</option>
            <option value="normal">Обычная</option>
            <option value="active">Активная</option>
          </select>
          <small className="settings-note">
            Уровень масштабирует частоту и смелость инициатив. «Активная» —
            чаще check-in, но не только советы. Общий вкл/выкл — переключатель
            «Инициативность Ari» в разделе ниже.
          </small>
        </label>
        <label className="settings-field">
          <span>Техническая детализация</span>
          <select
            value={settings.technicalDetail}
            onChange={(event) =>
              onChange({
                ...settings,
                technicalDetail: event.currentTarget
                  .value as AppSettings["technicalDetail"],
              })
            }
          >
            <option value="short">Кратко</option>
            <option value="balanced">Сбалансированно</option>
            <option value="detailed">Подробно</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Флирт и романтика</span>
          <select
            value={settings.romanceMode}
            onChange={(event) =>
              onChange({
                ...settings,
                romanceMode: event.currentTarget
                  .value as AppSettings["romanceMode"],
              })
            }
          >
            <option value="disabled">Выкл</option>
            <option value="subtle">Лёгкий</option>
            <option value="allowed">Разрешён</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Поведение ночью</span>
          <select
            value={settings.nightBehavior}
            onChange={(event) =>
              onChange({
                ...settings,
                nightBehavior: event.currentTarget
                  .value as AppSettings["nightBehavior"],
              })
            }
          >
            <option value="quiet">Тихий</option>
            <option value="normal">Обычный</option>
          </select>
        </label>
      </div>

      <div className="settings-section-card">
        <strong>Teach Ari — правила</strong>
        {preferenceRules.length === 0 ? (
          <span className="settings-note">Пока нет сохранённых правил.</span>
        ) : (
          preferenceRules.map((rule) => (
            <label key={rule.id} className="settings-field">
              <span>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => {
                    updatePreferenceRule(rule.id, {
                      enabled: event.target.checked,
                    });
                    setPreferenceRules(loadPreferenceRules());
                  }}
                />{" "}
                {rule.text}
              </span>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  removePreferenceRule(rule.id);
                  setPreferenceRules(loadPreferenceRules());
                }}
              >
                Удалить
              </button>
            </label>
          ))
        )}
      </div>

      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Живость аватара</strong>
            <span>
              Микрореакции, idle-анимации, взгляд и параллакс. Выключите, чтобы
              Ari была спокойнее без полного «Не отвлекать».
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.avatarLivelinessEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.avatarLivelinessEnabled}
            onClick={() =>
              onChange({
                ...settings,
                avatarLivelinessEnabled: !settings.avatarLivelinessEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
      </div>
        </SettingsCategory>

        <SettingsCategory
          id="initiative"
          title="Инициативность, реакции и фокус"
          description="Проактивность, сценарии, помодоро и тихие часы"
          badge={settings.proactiveEnabled || settings.eventReactionsEnabled || settings.pomodoroEnabled ? "вкл" : undefined}
          expanded={isCategoryOpen("initiative")}
          onToggle={toggleCategory}
        >

      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Инициативность Ari</strong>
            <span>
              Самостоятельные реплики с учётом времени, разговора, RAG и окна.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.proactiveEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.proactiveEnabled}
            onClick={() =>
              onChange({
                ...settings,
                proactiveEnabled: !settings.proactiveEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        <NumberSetting
          label="Интервал смолтока, минут"
          value={settings.proactiveSmalltalkIntervalMinutes}
          min={5}
          max={240}
          step={1}
          hint="Живые реплики, память и check-in без обязательных советов."
          onChange={(proactiveSmalltalkIntervalMinutes) =>
            onChange({ ...settings, proactiveSmalltalkIntervalMinutes })
          }
        />
        <NumberSetting
          label="Интервал советов, минут"
          value={settings.proactiveAdviceIntervalMinutes}
          min={1}
          max={240}
          step={1}
          hint="Практические советы при ошибках, застревании и рабочих сигналах."
          onChange={(proactiveAdviceIntervalMinutes) =>
            onChange({
              ...settings,
              proactiveAdviceIntervalMinutes,
              proactiveIntervalMinutes: proactiveAdviceIntervalMinutes,
            })
          }
        />
      </div>

      <div className="settings-section-card">
        <div className="settings-section-heading compact">
          <div>
            <strong>Баланс проактивности</strong>
            <span>
              Сегодня: советы {memoryHealth.proactiveTone.adviceToday} / смолток{" "}
              {memoryHealth.proactiveTone.smalltalkToday}. «Активная» инициатива
              не означает только советы — в паузах Ari чаще говорит как
              компаньон.
              {proactiveStatus ? ` ${proactiveStatus}` : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Советник программиста</strong>
            <span>
              Сигналы активности (окна, буфер, вопросы) → советы по отдыху,
              отладке, фокусу и живые темы для check-in. Локально, без «вижу экран».
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.advisorEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.advisorEnabled}
            onClick={() =>
              onChange({
                ...settings,
                advisorEnabled: !settings.advisorEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
      </div>

      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Пресет «Компаньон»</strong>
            <span>
              Память, инициатива, окно и реакции. Советы при ошибках и застревании;
              смолток в паузах и при возвращении.
            </span>
          </div>
          <button
            type="button"
            className="settings-action-button"
            onClick={() =>
              onChange({
                ...settings,
                userMemoryEnabled: true,
                proactiveEnabled: true,
                remindersEnabled: true,
                activityTrackingEnabled: true,
                eventReactionsEnabled: true,
                advisorEnabled: true,
                clipboardFullCaptureEnabled: true,
                initiativeLevel: "normal",
              })
            }
          >
            Применить
          </button>
        </div>
      </div>

      <div className="settings-section-card">
        <div className="settings-section-heading compact">
          <div>
            <strong>Помодоро</strong>
            <span>
              Таймер фокуса: Ari ненавязчиво поддерживает во время сессии.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.pomodoroEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.pomodoroEnabled}
            onClick={() =>
              onChange({
                ...settings,
                pomodoroEnabled: !settings.pomodoroEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        {settings.pomodoroEnabled && (
          <>
            <NumberSetting
              label="Фокус, минут"
              value={settings.pomodoroFocusMinutes}
              min={5}
              max={90}
              step={5}
              onChange={(pomodoroFocusMinutes) =>
                onChange({ ...settings, pomodoroFocusMinutes })
              }
            />
            <NumberSetting
              label="Перерыв, минут"
              value={settings.pomodoroBreakMinutes}
              min={1}
              max={30}
              step={1}
              onChange={(pomodoroBreakMinutes) =>
                onChange({ ...settings, pomodoroBreakMinutes })
              }
            />
          </>
        )}
        <div className="settings-section-heading compact">
          <div>
            <strong>Сценарии (packs)</strong>
            <span>Локальные наборы реакций Ari для разных режимов.</span>
          </div>
        </div>
        {scenarioPacks.map((pack) => (
          <div className="settings-section-heading compact" key={pack.id}>
            <div>
              <strong>{pack.name}</strong>
              <span>{pack.description}</span>
            </div>
            <button
              className={`toggle-switch${pack.enabled ? " enabled" : ""}`}
              type="button"
              role="switch"
              aria-checked={pack.enabled}
              onClick={() => {
                setScenarioPackEnabled(pack.id, !pack.enabled);
                setScenarioPacks(loadScenarioPacks());
              }}
            >
              <span />
            </button>
          </div>
        ))}
        <div className="settings-section-heading compact">
          <div>
            <strong>Открывать чат</strong>
            <span>Показывать инициативную реплику сразу после генерации.</span>
          </div>
          <button
            className={`toggle-switch${
              settings.proactiveOpenChat ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.proactiveOpenChat}
            onClick={() =>
              onChange({
                ...settings,
                proactiveOpenChat: !settings.proactiveOpenChat,
              })
            }
          >
            <span />
          </button>
        </div>
        <span className="settings-note">
          Для проверки коротких интервалов достаточно пары минут без ввода
          пользователя.
        </span>
        <div className="settings-section-heading compact">
          <div>
            <strong>Реакции на события</strong>
            <span>
              Учитывать длительную работу и значимую смену приложения.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.eventReactionsEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.eventReactionsEnabled}
            onClick={() =>
              onChange({
                ...settings,
                eventReactionsEnabled:
                  !settings.eventReactionsEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        <div className="settings-section-heading compact">
          <div>
            <strong>Напоминания о намерениях</strong>
            <span>
              Возвращаться к обещаниям и планам, для которых указан срок.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.remindersEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.remindersEnabled}
            onClick={() =>
              onChange({
                ...settings,
                remindersEnabled: !settings.remindersEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        <div className="settings-grid">
          <NumberSetting
            label="Тихие часы, с"
            value={settings.quietHoursStart}
            min={0}
            max={23}
            step={1}
            hint="Час начала (0–23), когда Ari не инициирует разговор."
            onChange={(quietHoursStart) =>
              onChange({ ...settings, quietHoursStart })
            }
          />
          <NumberSetting
            label="Тихие часы, до"
            value={settings.quietHoursEnd}
            min={0}
            max={23}
            step={1}
            hint="Час окончания. Одинаковые значения отключают тихие часы."
            onChange={(quietHoursEnd) =>
              onChange({ ...settings, quietHoursEnd })
            }
          />
        </div>
        <span className="settings-note">
          В тихие часы просроченные намерения ждут следующего подходящего
          времени. Одинаковые значения отключают тихие часы.
        </span>
      </div>

        </SettingsCategory>

        <SettingsCategory
          id="memory"
          title="Память, RAG и знания"
          description="Долговременная память и локальные документы"
          badge={settings.userMemoryEnabled || settings.ragEnabled ? "on" : undefined}
          expanded={isCategoryOpen("memory")}
          onToggle={toggleCategory}
        >
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Долговременная память</strong>
            <span>
              {memoryStats.facts} фактов · {memoryStats.summaries} сводок
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.userMemoryEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.userMemoryEnabled}
            onClick={() =>
              onChange({
                ...settings,
                userMemoryEnabled: !settings.userMemoryEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        <button
          className="settings-action-button"
          type="button"
          onClick={() => setMemoryOpen(true)}
        >
          Открыть и редактировать память
        </button>
        <span className="settings-note">
          Ari извлекает только устойчивые факты из ваших сообщений. Пароли,
          ключи и платёжные данные сохранять запрещено промптом.
        </span>
      </div>


      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Локальная память RAG</strong>
            <span>
              {ragStats.sources} документов · {ragStats.chunks} фрагментов
            </span>
          </div>
          <button
            className={`toggle-switch${settings.ragEnabled ? " enabled" : ""}`}
            type="button"
            role="switch"
            aria-checked={settings.ragEnabled}
            disabled={!isEmbeddingSourceConfigured(settings)}
            onClick={() =>
              onChange({ ...settings, ragEnabled: !settings.ragEnabled })
            }
          >
            <span />
          </button>
        </div>
        {isEmbeddingSourceConfigured(settings) &&
          settings.llmProvider === "ollama" && (
          <label className="settings-field">
            <span>Модель embeddings</span>
            <OllamaModelPicker
              value={settings.embeddingModel}
              models={showOllamaModelCatalog ? (status?.models ?? []) : []}
              onChange={(embeddingModel) =>
                applyEmbeddingSettingsChange(settings, onChange, {
                  embeddingModel,
                })
              }
            />
          </label>
        )}
        {settings.llmProvider === "gigachat" && (
          <span className="settings-note">
            Источник и модель embeddings — в блоке «Vision и embeddings» выше.
          </span>
        )}
        {isEmbeddingSourceConfigured(settings) && (
          <>
            <NumberSetting
              label="Фрагментов RAG в контексте (top-K)"
              value={settings.ragTopK}
              min={1}
              max={12}
              step={1}
              hint="Сколько фрагментов документов подмешивается в промпт."
              onChange={(ragTopK) => onChange({ ...settings, ragTopK })}
            />
            <NumberSetting
              label="Порог релевантности RAG (0–1)"
              value={settings.ragScoreThreshold}
              min={0.05}
              max={0.6}
              step={0.05}
              onChange={(ragScoreThreshold) =>
                onChange({ ...settings, ragScoreThreshold })
              }
            />
            <NumberSetting
              label="Мин. релевантность памяти (0–1)"
              value={settings.memoryRelevanceFloor}
              min={0.05}
              max={0.4}
              step={0.01}
              onChange={(memoryRelevanceFloor) =>
                onChange({ ...settings, memoryRelevanceFloor })
              }
            />
            <NumberSetting
              label="Вес лексики в recall (0–1)"
              value={settings.recallLexicalWeight}
              min={0.1}
              max={0.9}
              step={0.05}
              onChange={(recallLexicalWeight) =>
                onChange({ ...settings, recallLexicalWeight })
              }
            />
            <NumberSetting
              label="Вес семантики в recall (0–1)"
              value={settings.recallSemanticWeight}
              min={0.1}
              max={0.9}
              step={0.05}
              onChange={(recallSemanticWeight) =>
                onChange({ ...settings, recallSemanticWeight })
              }
            />
          </>
        )}
        <div className="settings-section-card">
          <div className="settings-section-heading">
            <div>
              <strong>Умный retrieval и инициатива</strong>
              <span>MMR-реранк, классификатор намерений, адаптивные пороги</span>
            </div>
          </div>
          <label className="settings-toggle-row">
            <span>MMR-реранк памяти и RAG</span>
            <button
              className={`toggle-switch${settings.rerankEnabled ? " enabled" : ""}`}
              type="button"
              role="switch"
              aria-checked={settings.rerankEnabled}
              onClick={() =>
                onChange({ ...settings, rerankEnabled: !settings.rerankEnabled })
              }
            >
              <span />
            </button>
          </label>
          <label className="settings-toggle-row">
            <span>LLM-реранк (доп. вызов модели)</span>
            <button
              className={`toggle-switch${settings.llmRerankEnabled ? " enabled" : ""}`}
              type="button"
              role="switch"
              aria-checked={settings.llmRerankEnabled}
              disabled={!settings.rerankEnabled}
              onClick={() =>
                onChange({
                  ...settings,
                  llmRerankEnabled: !settings.llmRerankEnabled,
                })
              }
            >
              <span />
            </button>
          </label>
          <label className="settings-toggle-row">
            <span>Классификатор намерений (без LLM)</span>
            <button
              className={`toggle-switch${
                settings.intentClassifierEnabled ? " enabled" : ""
              }`}
              type="button"
              role="switch"
              aria-checked={settings.intentClassifierEnabled}
              onClick={() =>
                onChange({
                  ...settings,
                  intentClassifierEnabled: !settings.intentClassifierEnabled,
                })
              }
            >
              <span />
            </button>
          </label>
          <label className="settings-toggle-row">
            <span>Адаптивная инициатива (online-обучение)</span>
            <button
              className={`toggle-switch${
                settings.adaptiveInitiativeEnabled ? " enabled" : ""
              }`}
              type="button"
              role="switch"
              aria-checked={settings.adaptiveInitiativeEnabled}
              onClick={() =>
                onChange({
                  ...settings,
                  adaptiveInitiativeEnabled: !settings.adaptiveInitiativeEnabled,
                })
              }
            >
              <span />
            </button>
          </label>
          {isEmbeddingSourceConfigured(settings) && (
            <NumberSetting
              label="TTL кэша embedding-запросов (сек)"
              value={settings.embeddingQueryCacheTtlSec}
              min={30}
              max={3600}
              step={30}
              onChange={(embeddingQueryCacheTtlSec) =>
                onChange({ ...settings, embeddingQueryCacheTtlSec })
              }
            />
          )}
        </div>
        {settings.llmProvider === "gigachat" &&
          embeddingSource === "none" && (
            <span className="settings-note">
              RAG и векторный поиск отключены. Чат и память Ari работают без
              embeddings.
            </span>
          )}
        <div className="settings-inline-actions">
          <button
            className="settings-action-button primary"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={
              ragBusy ||
              !ragEmbeddingReady ||
              !isEmbeddingSourceConfigured(settings)
            }
          >
            {ragBusy ? "Индексация…" : "Добавить файлы"}
          </button>
          <button
            className="settings-action-button"
            type="button"
            onClick={() => void clearKnowledge()}
            disabled={ragBusy || ragStats.chunks === 0}
          >
            Очистить
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept=".txt,.md,.json,.pdf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,application/json,application/pdf,image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => void importKnowledge(event.currentTarget.files)}
        />
        {ragMessage && <span className="settings-note">{ragMessage}</span>}
        {settings.ragEnabled &&
          ragStats.chunks > 0 &&
          !ragEmbeddingReady && (
            <span className="settings-note settings-error">
              В индексе {ragStats.chunks} фрагментов, но embedding-провайдер
              недоступен — поиск по документам в чате не работает. Запусти
              Ollama/GigaChat или переиндексируй после восстановления связи.
            </span>
          )}
        <span className="settings-note">
          После смены источника или модели embeddings очисти и заново
          проиндексируй документы: векторы разных моделей несовместимы.
        </span>
      </div>


        </SettingsCategory>

        <SettingsCategory
          id="vision"
          title="Зрение, экран и контекст"
          description="Авто-взгляд, буфер обмена и активное окно"
          badge={settings.autoVisionEnabled || settings.clipboardObservationEnabled || settings.clipboardFullCaptureEnabled || settings.activityTrackingEnabled || settings.advisorEnabled ? "on" : undefined}
          expanded={isCategoryOpen("vision")}
          onToggle={toggleCategory}
        >
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Авто-взгляд на экран</strong>
            <span>
              Редкие разрешённые снимки активного окна для любопытной реакции Ari.
              Требует контекст окна и allowlist. Окно Ari на ~0.35 с прячется при
              снимке.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.autoVisionEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.autoVisionEnabled}
            onClick={() =>
              onChange({
                ...settings,
                autoVisionEnabled: !settings.autoVisionEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
      </div>

      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Полный захват буфера обмена</strong>
            <span>
              Классифицирует каждое изменение буфера (код, ошибка, URL, текст),
              редактирует секреты и хранит локально ~8 ч для советов Ari. Только
              на вашем устройстве.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.clipboardFullCaptureEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.clipboardFullCaptureEnabled}
            onClick={() =>
              onChange({
                ...settings,
                clipboardFullCaptureEnabled:
                  !settings.clipboardFullCaptureEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
      </div>
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Наблюдение буфера обмена (ошибки)</strong>
            <span>
              Дополнительно: замечает скопированные ошибки/трейсбеки в рабочей
              памяти. Работает и без полного захвата.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.clipboardObservationEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.clipboardObservationEnabled}
            onClick={() =>
              onChange({
                ...settings,
                clipboardObservationEnabled:
                  !settings.clipboardObservationEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
      </div>
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Контекст активного окна</strong>
            <span>Только приложение и заголовок окна, без снимков и клавиш.</span>
          </div>
          <button
            className={`toggle-switch${
              settings.activityTrackingEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.activityTrackingEnabled}
            onClick={() =>
              onChange({
                ...settings,
                activityTrackingEnabled:
                  !settings.activityTrackingEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        <label className="settings-field">
          <span>Разрешённые процессы через запятую (пусто — все)</span>
          <input
            value={settings.activityAllowlist}
            placeholder="Code.exe, chrome.exe"
            onChange={(event) =>
              onChange({
                ...settings,
                activityAllowlist: event.currentTarget.value,
              })
            }
          />
        </label>
        <label className="settings-field">
          <span>Доп. IDE/редакторы (через запятую)</span>
          <input
            value={settings.codingProcessAllowlist}
            placeholder="myide.exe, custom-editor"
            onChange={(event) =>
              onChange({
                ...settings,
                codingProcessAllowlist: event.currentTarget.value,
              })
            }
          />
        </label>
        <label className="settings-field">
          <span>Доп. отвлекающие приложения (через запятую)</span>
          <input
            value={settings.distractorProcessAllowlist}
            placeholder="game.exe, social-app"
            onChange={(event) =>
              onChange({
                ...settings,
                distractorProcessAllowlist: event.currentTarget.value,
              })
            }
          />
        </label>
      </div>


        </SettingsCategory>

        <SettingsCategory
          id="voice"
          title="Голос и звуки"
          description="Blip Voice и звуки присутствия"
          badge={settings.soundsEnabled || settings.voiceStyle === "blip" ? "on" : undefined}
          expanded={isCategoryOpen("voice")}
          onToggle={toggleCategory}
        >
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Звуки присутствия</strong>
            <span>Тихий pop и reaction tick; ночью звуки не играют.</span>
          </div>
          <button
            className={`toggle-switch${settings.soundsEnabled ? " enabled" : ""}`}
            type="button"
            role="switch"
            aria-checked={settings.soundsEnabled}
            onClick={() =>
              onChange({ ...settings, soundsEnabled: !settings.soundsEnabled })
            }
          >
            <span />
          </button>
        </div>
      </div>


      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Голос Ari (Blip Voice)</strong>
            <span>
              Animalese-like щебет: {settings.voiceStyle === "blip" ? "включён" : "выключен"}
            </span>
          </div>
        </div>
        <BlipVoiceSettingsPanel
          embedded
          settings={settings}
          onChange={onChange}
          onBack={() => {}}
        />
      </div>


        </SettingsCategory>

        <SettingsCategory
          id="privacy"
          title="Приватность и тишина"
          description="Режим «Не отвлекать»"
          badge={isQuietModeActive(settings, activeWindow) ? "on" : undefined}
          expanded={isCategoryOpen("privacy")}
          onToggle={toggleCategory}
        >
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Не отвлекать</strong>
            <span>{quietModeLabel(settings)}</span>
          </div>
          <button
            className={`toggle-switch${isQuietModeActive(settings, activeWindow) ? " enabled" : ""}`}
            type="button"
            role="switch"
            aria-checked={isQuietModeActive(settings, activeWindow)}
            onClick={() =>
              onChange({
                ...settings,
                quietMode: settings.quietMode === "off" ? "manual" : "off",
                quietModeUntil: undefined,
                quietModeProcess: undefined,
              })
            }
          >
            <span />
          </button>
        </div>
        <div className="settings-inline-actions quiet-mode-actions">
          <button type="button" onClick={() => onChange({ ...settings, quietMode: "until", quietModeUntil: Date.now() + 30 * 60_000 })}>30 минут</button>
          <button type="button" onClick={() => onChange({ ...settings, quietMode: "until", quietModeUntil: Date.now() + 60 * 60_000 })}>1 час</button>
          <button
            type="button"
            onClick={() => {
              const until = new Date();
              until.setHours(20, 0, 0, 0);
              if (until.getTime() <= Date.now()) until.setDate(until.getDate() + 1);
              onChange({ ...settings, quietMode: "until", quietModeUntil: until.getTime() });
            }}
          >
            До вечера
          </button>
          <button
            type="button"
            disabled={!activeWindow?.processName}
            onClick={() =>
              onChange({
                ...settings,
                quietMode: "process",
                quietModeProcess: activeWindow?.processName,
                quietModeUntil: undefined,
              })
            }
          >
            Текущий процесс
          </button>
        </div>
        <span className="settings-note">
          Инициативы, event reactions и некритичные напоминания ждут. Тихие
          визуальные состояния остаются.
        </span>
      </div>


        </SettingsCategory>

        <SettingsCategory
          id="safety"
          title="Безопасные действия"
          description="Подтверждённые действия и журнал"
          badge={settings.safeActionsEnabled ? "on" : undefined}
          expanded={isCategoryOpen("safety")}
          onToggle={toggleCategory}
        >
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Безопасные действия</strong>
            <span>
              Открытие ссылок и локальных данных, буфер и заметки — только
              после подтверждения.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.safeActionsEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.safeActionsEnabled}
            onClick={() =>
              onChange({
                ...settings,
                safeActionsEnabled: !settings.safeActionsEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        <span className="settings-note">
          Исполняемые файлы, скрипты, произвольные команды и действия без
          явной просьбы запрещены. Последние 100 решений хранятся локально.
        </span>
        {actionLog.slice(0, 5).map((entry) => (
          <div
            className="safe-action-log-entry"
            key={`${entry.timestamp}-${entry.title}`}
          >
            <div>
              <strong>{entry.title}</strong>
              <span>
                {new Date(entry.timestamp).toLocaleString("ru-RU")}
              </span>
            </div>
            <small className={entry.status}>{entry.result}</small>
          </div>
        ))}
        {actionLog.length > 0 && (
          <button
            className="settings-action-button"
            type="button"
            onClick={clearSafeActionLog}
          >
            Очистить журнал действий
          </button>
        )}
      </div>


        </SettingsCategory>

        <SettingsCategory
          id="tasks"
          title="Дела, проекты и диагностика"
          description="Проекты, задачи и обзоры"
          expanded={isCategoryOpen("tasks")}
          onToggle={toggleCategory}
        >
      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Дела и проекты</strong>
            <span>
              Задачи, напоминания и предложения — на панели рядом с Ari. Проекты
              — здесь.
            </span>
          </div>
        </div>
        <button
          className="settings-action-button"
          type="button"
          onClick={() => setProjectBinderOpen(true)}
        >
          Проекты
        </button>
      </div>


      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Диагностика Ari</strong>
            <span>
              Фокус, обзоры, лента активности и почему Ari молчит (подавления
              инициативы, следующая проверка).
            </span>
          </div>
          <button
            type="button"
            className="settings-action-button"
            onClick={() => setDiagnosticsExpanded((value) => !value)}
          >
            {diagnosticsExpanded ? "Скрыть" : "Показать"}
          </button>
        </div>
        {diagnosticsExpanded && <AriDiagnosticsSection />}
      </div>

      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Proactive Lab</strong>
            <span>
              Preview LLM synthesis, adviceSteps, usefulness score и тестовый
              fire проактивной инициативы.
            </span>
          </div>
          <button
            type="button"
            className="settings-action-button"
            onClick={() => setProactiveLabExpanded((value) => !value)}
          >
            {proactiveLabExpanded ? "Скрыть" : "Показать"}
          </button>
        </div>
        {proactiveLabExpanded && <ProactiveLabSection settings={settings} />}
      </div>


      <div className="settings-section-card">
        <div className="settings-section-heading">
          <div>
            <strong>Поиск в интернете</strong>
            <span>
              Ari может автоматически искать актуальную информацию, читать
              страницы по URL и уточнять дату/время перед ответом. Запросы
              уходят из приложения в интернет.
            </span>
          </div>
          <button
            className={`toggle-switch${
              settings.webToolsEnabled ? " enabled" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={settings.webToolsEnabled}
            onClick={() =>
              onChange({
                ...settings,
                webToolsEnabled: !settings.webToolsEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
      </div>
        </SettingsCategory>

        <SettingsCategory
          id="system"
          title="Система и данные"
          description="Автозапуск, резервные копии, диагностика и обновления"
          expanded={isCategoryOpen("system")}
          onToggle={toggleCategory}
        >
      <div className="desktop-settings-section">
        <div>
          <strong>Запуск вместе с Windows</strong>
          <span>Регистрация управляется самой системой.</span>
        </div>
        <button
          className={`toggle-switch${autostartEnabled ? " enabled" : ""}`}
          type="button"
          role="switch"
          aria-checked={autostartEnabled}
          onClick={() => void toggleAutostart()}
          disabled={autostartLoading}
        >
          <span />
        </button>
      </div>

      <div className="settings-section-card">
        <strong>Самодиагностика</strong>
        <div className="settings-grid">
          <div>
            <span>Провайдер</span>
            <strong>
              {settings.llmProvider === "gigachat"
                ? status?.online
                  ? "GigaChat онлайн"
                  : "GigaChat офлайн"
                : status?.online
                  ? "Ollama онлайн"
                  : "Ollama офлайн"}
            </strong>
          </div>
          <div>
            <span>Модели Ollama</span>
            <strong>{status?.models.length ?? 0}</strong>
          </div>
          <div>
            <span>Память</span>
            <strong>
              {memoryStats.activeFacts} активных · {memoryStats.summaries} сводок
            </strong>
          </div>
          <div>
            <span>RAG</span>
            <strong>
              {ragStats.sources} док. · {ragStats.chunks} фрагм.
            </strong>
          </div>
          <div>
            <span>Авто-память сегодня</span>
            <strong>{memoryHealth.autoCommitsToday}</strong>
          </div>
          <div>
            <span>Инициативы сегодня</span>
            <strong>{memoryHealth.initiativesToday}</strong>
          </div>
          <div>
            <span>Inbox кандидаты</span>
            <strong>{memoryHealth.lastInboxCandidates.length}</strong>
          </div>
          <div>
            <span>Урезания контекста</span>
            <strong>{memoryHealth.lastContextTrims.length}</strong>
          </div>
        </div>
        {memoryHealth.lastAutoCommits.length > 0 && (
          <div className="settings-note">
            <strong>Последние auto-commit:</strong>{" "}
            {memoryHealth.lastAutoCommits
              .map((entry) => entry.text.slice(0, 48))
              .join(" · ")}
          </div>
        )}
        {memoryHealth.lastSuppressions.length > 0 && (
          <div className="settings-note">
            <strong>Подавления инициатив:</strong>{" "}
            {memoryHealth.lastSuppressions
              .map((entry) => entry.reason.slice(0, 56))
              .join(" · ")}
          </div>
        )}
        {retrievalHealth.lastPasses.length > 0 && (
          <>
            <div className="settings-note">
              <strong>Retrieval:</strong> IVF{" "}
              {Math.round(retrievalHealth.ivfShare * 100)}% · MMR{" "}
              {Math.round(retrievalHealth.mmrShare * 100)}% · shrink{" "}
              {retrievalHealth.avgShrinkRatio.toFixed(2)}
            </div>
            <div className="settings-note">
              <strong>Последний проход:</strong>{" "}
              {retrievalHealth.lastPasses[retrievalHealth.lastPasses.length - 1]
                ?.searchMode ?? "—"}{" "}
              · RAG{" "}
              {
                retrievalHealth.lastPasses[retrievalHealth.lastPasses.length - 1]
                  ?.ragIn
              }
              →
              {
                retrievalHealth.lastPasses[retrievalHealth.lastPasses.length - 1]
                  ?.ragOut
              }{" "}
              · факты{" "}
              {
                retrievalHealth.lastPasses[retrievalHealth.lastPasses.length - 1]
                  ?.factsIn
              }
              →
              {
                retrievalHealth.lastPasses[retrievalHealth.lastPasses.length - 1]
                  ?.factsOut
              }{" "}
              · эпизоды{" "}
              {
                retrievalHealth.lastPasses[retrievalHealth.lastPasses.length - 1]
                  ?.episodesIn
              }
              →
              {
                retrievalHealth.lastPasses[retrievalHealth.lastPasses.length - 1]
                  ?.episodesOut
              }
            </div>
          </>
        )}
      </div>

      <button
        className="settings-check-button"
        type="button"
        onClick={() => void refreshStatus()}
        disabled={checking}
      >
        Обновить состояние
      </button>

      <p className="settings-note">
        Privacy: память, RAG, активность, инициативы и safe actions управляются
        переключателями в настройках. Данные остаются локально на устройстве.
      </p>

      <div className="settings-section-card">
        <strong>Данные Ari</strong>
        <div className="settings-section-heading compact">
          <div>
            <strong>Авто-обновления</strong>
            <span>
              Проверка релизов при старте. Сейчас отключено в сборке — нужны
              подписанный билд и настроенный update endpoint.
            </span>
          </div>
          <button
            className={`toggle-switch${settings.autoUpdateEnabled ? " enabled" : ""}`}
            type="button"
            role="switch"
            aria-checked={settings.autoUpdateEnabled}
            onClick={() =>
              onChange({
                ...settings,
                autoUpdateEnabled: !settings.autoUpdateEnabled,
              })
            }
          >
            <span />
          </button>
        </div>
        <button type="button" onClick={() => void exportAriData()}>
          Export Ari data
        </button>
        <label className="settings-field">
          <span>Import Ari data (.zip)</span>
          <input
            type="file"
            accept=".zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importAriData(file).then((warnings) => {
                if (warnings.length) alert(warnings.join("\n"));
              });
            }}
          />
        </label>
        <button type="button" onClick={() => void backupBeforeUpdate()}>
          Резервная копия перед обновлением
        </button>
        <button type="button" onClick={() => void resetOnlyMemory()}>
          Сбросить только память
        </button>
        <button type="button" onClick={() => void resetOnlyRag()}>
          Сбросить только RAG
        </button>
        <button type="button" onClick={() => resetRelationshipAndMood()}>
          Сбросить отношения и настроение
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("Удалить все локальные данные Ari?")) {
              void resetAllLocalData();
            }
          }}
        >
          Сбросить все локальные данные
        </button>
        <button
          type="button"
          className="settings-action-button"
          onClick={() =>
            onChange({ ...settings, onboardingCompleted: false })
          }
        >
          Пройти онбординг заново
        </button>
      </div>

      <button
        className="settings-about-button"
        type="button"
        onClick={() => setAboutOpen(true)}
      >
        О приложении
      </button>
        </SettingsCategory>

      {(status?.error || operationError || autostartError) && (
        <p className="settings-error">
          {operationError ?? status?.error ?? autostartError}
        </p>
      )}
      </div>
    </div>
  );
}
