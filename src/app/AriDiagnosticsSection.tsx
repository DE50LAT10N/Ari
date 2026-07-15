import { useEffect, useState } from "react";
import {
  formatPomodoroRemaining,
  loadPomodoroState,
  type PomodoroState,
} from "../character/pomodoro";
import {
  countFocusSessionsToday,
  getActiveFocusSession,
  type FocusSession,
} from "../character/focusSession";
import { formatReminderTime } from "../character/reminders";
import { loadTimelineForDay } from "../memory/activityTimeline";
import {
  buildDailyReview,
  buildWeeklyReview,
  formatDailyReview,
  formatWeeklyReview,
} from "../memory/reviewAggregator";
import { getNextTask } from "../tasks/taskStore";
import {
  EXPERIMENTAL_UNRESTRICTED_CONTEXT,
  loadSettings,
} from "../settings/appSettings";
import {
  buildAdvisorContext,
  buildAdvisorDiagnostics,
} from "../character/advisorEngine";
import { formatActivitySignalsForDiagnostics } from "../memory/activitySignals";
import {
  getLastAdviceAttemptAt,
  getLastAdviceDecision,
  getLastProactiveMessageAt,
  getLastSmalltalkAttemptAt,
  getProactiveFailureBackoff,
} from "../character/proactiveState";
import {
  getLastAdviceUrgency,
  describeAdviceReadiness,
  computeCadencePressure,
} from "../character/adviceUrgency";
import { describeAdviceFinalGateForDiagnostics } from "../character/adviceFinalGate";
import { describeAdviceEngineForDiagnostics } from "../character/adviceEngine";
import { describeRelevanceRankerForDiagnostics } from "../character/relevanceRanker";
import {
  getLastProactiveLlmBundle,
  getLastProactiveSynthesisReject,
  loadProactiveSynthesisDiagnostics,
} from "../character/proactiveLlmEngine";
import {
  dailyInitiativeCap,
  proactiveAdviceIntervalMs,
  proactiveSmalltalkIntervalMs,
} from "../character/initiativeConfig";
import { getDailyInitiativeCount } from "../character/initiativeScoring";
import { getMemoryHealthSnapshot, summarizeInitiativeSuppressions } from "../memory/memoryTelemetry";
import { isLlmProviderOnline } from "../llm/providerOnline";
import { getGigaChatAuthKeyPresent } from "../llm/gigaChatStatus";
import { getGigaChatRateLimitState } from "../llm/gigaChatRateLimit";
import { loadGigaChatDiagnostics } from "../llm/gigaChatDiagnostics";
import { resolveModel, resolveSynthesisModel } from "../llm/modelRouter";
import {
  formatMoodTimelineForDiagnostics,
  getCurrentMoodLayers,
  moodVectorToPrompt,
} from "../character/moodEngine";
import { getInteractionAcknowledgementSummary } from "../character/interactionAcknowledgement";
import type { IdeWorkspaceSnapshot } from "../ide/protocol";
import type { IdeBridgeNativeStatus } from "../platform/ideBridgeNative";

type DeskSnapshot = {
  focusSession: FocusSession | null;
  pomodoroState: PomodoroState;
  nextTaskTitle: string | null;
  nextTaskDueAt: number | null;
  todayFocusCount: number;
};

type ProactiveDebug = {
  providerLabel: string;
  providerOnline: boolean;
  advisorEnabled: boolean;
  adviceSlotActive: boolean;
  initiativesToday: number;
  dailyCap: number;
  nextAdviceSec: number;
  nextAdviceLabel: string;
  adviceBlockReason: string | null;
  adviceReady: boolean;
  nextSmalltalkSec: number;
  lastSuppressions: string[];
  suppressionSummary: Array<{ reason: string; count: number }>;
  adviceUrgencyLevel: string;
  adviceUrgencyScore: number;
  adviceUrgencyReasons: string[];
  adviceEffectiveIntervalMin: number;
  adviceOutcomeReputation: string | null;
  smalltalkEffectiveIntervalMin: number;
  lastBundleScore: number | null;
  lastBundleShouldSend: boolean | null;
  lastInitiativeMove: string | null;
  lastPrimaryChain: string | null;
  lastBundleSource: string | null;
  lastSynthesisReject: string | null;
  synthesisAttempts: string[];
  adviceToday: number;
  smalltalkToday: number;
  lastAdviceDecision: string | null;
  engineStrategy: string;
  engineReason: string;
  engineTrace: string[];
  engineMoveReputation: string[];
  adviceFinalGate: string | null;
  cadencePressure: string;
  relevanceWinner: string;
  relevanceScores: string[];
  relevanceLearnedEvents: number;
  relevanceLastUpdate: string | null;
  relevanceRecentUpdates: string[];
  moodPolicy: string;
  moodLayers: string;
  moodTimeline: string[];
  acknowledgementStatus: string;
};

function buildSnapshot(): DeskSnapshot {
  const next = getNextTask();
  return {
    focusSession: getActiveFocusSession(),
    pomodoroState: loadPomodoroState(),
    nextTaskTitle: next?.title ?? null,
    nextTaskDueAt: next?.dueAt ?? null,
    todayFocusCount: countFocusSessionsToday(),
  };
}

function buildProactiveDebug(ollamaOnline: boolean | null): ProactiveDebug {
  const settings = loadSettings();
  const adviceIntervalMs = proactiveAdviceIntervalMs(settings);
  const smalltalkIntervalMs = proactiveSmalltalkIntervalMs(settings);
  const now = Date.now();
  const nextSmalltalkSec = Math.max(
    0,
    Math.ceil(
      (smalltalkIntervalMs - (now - getLastSmalltalkAttemptAt())) / 1000,
    ),
  );
  const health = getMemoryHealthSnapshot();
  const suppressionSummary = summarizeInitiativeSuppressions().slice(0, 4);
  const isGigaChat = settings.llmProvider === "gigachat";
  const providerOnline = isLlmProviderOnline(settings, ollamaOnline);
  const urgency = getLastAdviceUrgency();
  const lastBundle = getLastProactiveLlmBundle();
  const lastReject = getLastProactiveSynthesisReject();
  const synthesisAttempts = loadProactiveSynthesisDiagnostics()
    .slice(-8)
    .reverse()
    .map((entry) => {
      const score = entry.usefulnessScore === undefined
        ? ""
        : ` score=${entry.usefulnessScore.toFixed(2)}`;
      const sendState = entry.shouldSend === undefined
        ? ""
        : ` send=${entry.shouldSend ? "yes" : "no"}`;
      const send = ` tone=${entry.tone ?? "legacy"}${sendState}`;
      return `${new Date(entry.at).toLocaleTimeString("ru-RU")} ${entry.provider}/${entry.model} ${entry.phase} ${entry.outcome}${score}${send} · ${entry.factCount} facts [${entry.factKinds.join(",")}] · ${entry.reason}`;
    });
  const sinceAdviceAttempt = now - getLastAdviceAttemptAt();
  const adviceReadiness = describeAdviceReadiness(urgency, {
    advisorEnabled: settings.advisorEnabled,
    llmOnline: providerOnline,
    sinceAdviceAttemptMs: sinceAdviceAttempt,
    adviceIntervalMs,
    now,
  });
  const engineDebug = describeAdviceEngineForDiagnostics();
  const relevance = describeRelevanceRankerForDiagnostics();
  const moodLayers = getCurrentMoodLayers({ now });
  const moodPolicy = moodVectorToPrompt(moodLayers.vector).policy;
  const acknowledgement = getInteractionAcknowledgementSummary(now);
  const cadence = urgency
    ? computeCadencePressure(
        urgency,
        sinceAdviceAttempt,
        now,
        adviceIntervalMs,
      )
    : { level: "none" as const, reasons: [] };

  return {
    providerLabel: isGigaChat ? "GigaChat" : "Ollama",
    providerOnline,
    advisorEnabled: settings.advisorEnabled,
    adviceSlotActive:
      settings.advisorEnabled &&
      providerOnline &&
      urgency !== null &&
      urgency.level !== "none",
    initiativesToday: getDailyInitiativeCount(),
    dailyCap: dailyInitiativeCap(settings),
    nextAdviceSec: adviceReadiness.intervalWaitSec,
    nextAdviceLabel: adviceReadiness.label,
    adviceBlockReason: adviceReadiness.blockReason,
    adviceReady: adviceReadiness.ready,
    nextSmalltalkSec,
    lastSuppressions: health.lastSuppressions
      .slice(-3)
      .map((entry) => entry.reason),
    suppressionSummary,
    adviceUrgencyLevel: urgency?.level ?? "—",
    adviceUrgencyScore: urgency?.score ?? 0,
    adviceUrgencyReasons: urgency?.reasons ?? [],
    adviceEffectiveIntervalMin: urgency
      ? Math.ceil(urgency.effectiveIntervalMs / 60_000)
      : Math.ceil(adviceIntervalMs / 60_000),
    adviceOutcomeReputation: urgency?.outcomeReputation?.sampleSize
      ? `${urgency.outcomeReputation.label} · score ${urgency.outcomeReputation.score.toFixed(2)} · interval x${urgency.outcomeReputation.intervalMultiplier.toFixed(2)}`
      : null,
    smalltalkEffectiveIntervalMin: Math.ceil(smalltalkIntervalMs / 60_000),
    lastBundleScore: lastBundle?.usefulnessScore ?? null,
    lastBundleShouldSend: lastBundle ? lastBundle.shouldSend : null,
    lastInitiativeMove: lastBundle?.initiativeMove ?? null,
  lastPrimaryChain:
      lastBundle?.primaryChainSummary ?? lastBundle?.narrativeBrief ?? null,
    lastBundleSource: lastBundle?.source ?? null,
    lastSynthesisReject: lastReject
      ? `${lastReject.tone} · score ${lastReject.usefulnessScore.toFixed(2)} · ${lastReject.rejectReason ?? "отклонён"}`
      : null,
    synthesisAttempts,
    adviceToday: health.proactiveTone.adviceToday,
    smalltalkToday: health.proactiveTone.smalltalkToday,
    lastAdviceDecision: getLastAdviceDecision(),
    engineStrategy: engineDebug.strategy,
    engineReason: engineDebug.reason,
    engineTrace: engineDebug.trace.slice(-6),
    engineMoveReputation: engineDebug.moveReputation,
    adviceFinalGate: describeAdviceFinalGateForDiagnostics(),
    cadencePressure:
      cadence.reasons.length > 0
        ? `${cadence.level}: ${cadence.reasons.join(" · ")}`
        : cadence.level,
    relevanceWinner: relevance.winner,
    relevanceScores: relevance.scores,
    relevanceLearnedEvents: relevance.learnedEvents,
    relevanceLastUpdate: relevance.lastUpdate,
    relevanceRecentUpdates: relevance.recentUpdates,
    moodPolicy: `${moodPolicy.archetype} · len ${moodPolicy.replyLength} · thought ${moodPolicy.thoughtBubbleChance.toFixed(2)} · initiative ${moodPolicy.initiativeBias.toFixed(2)}`,
    moodLayers: `now ${moodLayers.vector.warmth.toFixed(2)}/${moodLayers.vector.energy.toFixed(2)}/${moodLayers.vector.irritation.toFixed(2)} · base ${moodLayers.baselineVector.warmth.toFixed(2)}/${moodLayers.baselineVector.energy.toFixed(2)}/${moodLayers.baselineVector.irritation.toFixed(2)} · react ${moodLayers.reactiveVector.warmth.toFixed(2)}/${moodLayers.reactiveVector.energy.toFixed(2)}/${moodLayers.reactiveVector.irritation.toFixed(2)}`,
    acknowledgementStatus: `pending ${acknowledgement.pending} · ignored ${acknowledgement.ignoredStreak} · repair ${
      acknowledgement.lastRepairAt
        ? `${Math.max(0, Math.round((now - acknowledgement.lastRepairAt) / 1000))}s ago`
        : "—"
    } · source ${acknowledgement.lastIgnoredSource ?? "—"}`,
    moodTimeline: formatMoodTimelineForDiagnostics(4),
  };
}

export function AriDiagnosticsSection({
  ollamaOnline,
  ideAdvisorStatus,
  ideAdvisorSnapshot,
  ideAdvisorError,
}: {
  ollamaOnline: boolean | null;
  ideAdvisorStatus: IdeBridgeNativeStatus;
  ideAdvisorSnapshot: IdeWorkspaceSnapshot | null;
  ideAdvisorError: string | null;
}) {
  const [desk, setDesk] = useState<DeskSnapshot | null>(null);
  const [timeline, setTimeline] = useState<string[]>([]);
  const [dailyHighlight, setDailyHighlight] = useState("");
  const [weeklyHighlight, setWeeklyHighlight] = useState("");
  const [advisorAngle, setAdvisorAngle] = useState<string>("—");
  const [advisorFlags, setAdvisorFlags] = useState<string>("—");
  const [advisorTopics, setAdvisorTopics] = useState<string[]>([]);
  const [signalLines, setSignalLines] = useState<string[]>([]);
  const [proactiveDebug, setProactiveDebug] = useState<ProactiveDebug | null>(
    null,
  );

  useEffect(() => {
    const refresh = () => {
      setDesk(buildSnapshot());
      setTimeline(
        loadTimelineForDay()
          .slice(0, 8)
          .map((event) => `[${event.kind}] ${event.summary}`),
      );
      const daily = buildDailyReview();
      const weekly = buildWeeklyReview();
      setDailyHighlight(
        daily.highlights[0] ?? formatDailyReview(daily).split("\n")[0],
      );
      setWeeklyHighlight(
        weekly.themes[0] ?? formatWeeklyReview(weekly).split("\n")[0],
      );
      const settings = loadSettings();
      const advisorCtx = buildAdvisorContext(settings);
      const diagnostics = buildAdvisorDiagnostics(advisorCtx);
      setAdvisorAngle(diagnostics.angle ?? "none");
      setAdvisorFlags(diagnostics.flags);
      setAdvisorTopics(diagnostics.topics);
      setSignalLines(formatActivitySignalsForDiagnostics(6));
      setProactiveDebug(buildProactiveDebug(ollamaOnline));
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    const events = [
      "ari-pomodoro-changed",
      "ari-focus-session-changed",
      "ari-focus-session-ended",
      "ari-timeline-changed",
      "ari-tasks-changed",
      "ari-proactive-state-changed",
      "ari-mood-timeline-changed",
    ];
    for (const name of events) {
      window.addEventListener(name, refresh);
    }
    return () => {
      window.clearInterval(timer);
      for (const name of events) {
        window.removeEventListener(name, refresh);
      }
    };
  }, [ollamaOnline]);

  if (!desk) {
    return <p className="settings-note">Загрузка диагностики…</p>;
  }

  const focusActive = Boolean(desk.focusSession && !desk.focusSession.endedAt);
  const settings = loadSettings();
  const gigaKeyPresent = getGigaChatAuthKeyPresent();
  const gigaRate = getGigaChatRateLimitState();
  const gigaTrace = loadGigaChatDiagnostics().slice(-5).reverse();
  const proactiveBackoff = getProactiveFailureBackoff();

  return (
    <div className="ari-diagnostics-section">
      <dl className="ari-desk-list">
        <div>
          <dt>Context profile</dt>
          <dd>
            {EXPERIMENTAL_UNRESTRICTED_CONTEXT
              ? "experimental unrestricted · privacy gates bypassed"
              : "consent-controlled"}
          </dd>
        </div>
        <div>
          <dt>Фокус</dt>
          <dd>
            {focusActive
              ? desk.focusSession?.goal ?? "цель не задана"
              : "не активен"}
            {desk.focusSession?.currentStep
              ? ` · ${desk.focusSession.currentStep}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Помодоро</dt>
          <dd>
            {formatPomodoroRemaining(desk.pomodoroState) || "—"}
            {desk.pomodoroState.phase !== "idle"
              ? ` · ${desk.pomodoroState.phase === "focus" ? "фокус" : desk.pomodoroState.phase === "break" ? "перерыв" : "пауза"}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Следующая задача</dt>
          <dd>
            {desk.nextTaskTitle
              ? desk.nextTaskDueAt
                ? `${desk.nextTaskTitle} (${formatReminderTime(desk.nextTaskDueAt)})`
                : desk.nextTaskTitle
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Фокус-сессий сегодня</dt>
          <dd>{desk.todayFocusCount}</dd>
        </div>
        <div>
          <dt>Советник: угол</dt>
          <dd>{advisorAngle}</dd>
        </div>
        <div>
          <dt>Советник: флаги</dt>
          <dd>{advisorFlags}</dd>
        </div>
        <div>
          <dt>IDE Bridge</dt>
          <dd>
            {ideAdvisorStatus.running ? "running" : "stopped"} ·{" "}
            {ideAdvisorStatus.connection} · client {ideAdvisorStatus.client ?? "—"}
            {ideAdvisorStatus.lastMessageAt
              ? ` · last ${Math.max(0, Math.round((Date.now() - ideAdvisorStatus.lastMessageAt) / 1000))}s ago`
              : ""}
          </dd>
        </div>
        <div>
          <dt>IDE snapshot</dt>
          <dd>
            {ideAdvisorSnapshot
              ? `rev ${ideAdvisorSnapshot.revision} · age ${Math.max(0, Math.round((Date.now() - ideAdvisorSnapshot.capturedAt) / 1000))}s · diagnostics ${ideAdvisorSnapshot.diagnostics?.length ?? 0} · editor ${ideAdvisorSnapshot.activeEditor?.uri ?? "—"}`
              : "нет свежего snapshot"}
          </dd>
        </div>
        <div>
          <dt>IDE sharing</dt>
          <dd>
            {ideAdvisorSnapshot
              ? Object.entries(ideAdvisorSnapshot.sharing)
                  .map(([key, enabled]) => `${key}=${enabled ? "on" : "off"}`)
                  .join(" · ")
              : "—"}
          </dd>
        </div>
        {ideAdvisorError && (
          <div>
            <dt>IDE Bridge error</dt>
            <dd>{ideAdvisorError}</dd>
          </div>
        )}
        {proactiveDebug && (
          <>
            <div>
              <dt>Проактивность</dt>
              <dd>
                {settings.proactiveEnabled ? "вкл" : "выкл"} ·{" "}
                {proactiveDebug.initiativesToday} сегодня, без лимита
              </dd>
            </div>
            <div>
              <dt>Слот совета</dt>
              <dd>
                {proactiveDebug.advisorEnabled ? "советник вкл" : "советник выкл"}{" "}
                · LLM{" "}
                {proactiveDebug.providerOnline ? "online" : "offline"} ·{" "}
                {proactiveDebug.adviceSlotActive
                  ? "есть сигналы"
                  : "только presence"}
              </dd>
            </div>
            <div>
              <dt>Модель чата</dt>
              <dd>
                {settings.llmProvider === "gigachat"
                  ? settings.gigaChatModel
                  : settings.model}
              </dd>
            </div>
            {settings.llmProvider === "gigachat" && (
              <>
                <div>
                  <dt>JSON / инициатива (факт.)</dt>
                  <dd>
                    JSON {resolveModel("json", settings)} · synthesis{" "}
                    {resolveSynthesisModel(settings)}
                  </dd>
                </div>
                <div>
                  <dt>Vision (факт.)</dt>
                  <dd>{resolveModel("vision", settings)}</dd>
                </div>
              </>
            )}
            <div>
              <dt>LLM ({proactiveDebug.providerLabel})</dt>
              <dd>
                {settings.llmProvider === "gigachat"
                  ? gigaKeyPresent
                    ? proactiveDebug.providerOnline
                      ? "online"
                      : "ключ есть, ждёт успешный запрос"
                    : "ключ не найден"
                  : "см. статус Ollama в чате"}
              </dd>
            </div>
            {settings.llmProvider === "gigachat" && (
              <>
                <div>
                  <dt>GigaChat transport</dt>
                  <dd>
                    {gigaRate.phase}
                    {gigaRate.activeKind ? ` · ${gigaRate.activeKind}` : ""}
                    {` · queue ${gigaRate.queuedCount}`}
                    {gigaRate.queuedInteractive > 0
                      ? ` (${gigaRate.queuedInteractive} interactive)`
                      : ""}
                    {gigaRate.cooldownMs > 0
                      ? ` · cooldown ${Math.ceil(gigaRate.cooldownMs / 1000)}s`
                      : ""}
                    {gigaRate.throttleFailures > 0
                      ? ` · throttles ${gigaRate.throttleFailures}`
                      : ""}
                  </dd>
                </div>
                {gigaTrace.length > 0 && (
                  <div>
                    <dt>GigaChat trace</dt>
                    <dd>
                      {gigaTrace
                        .map(
                          (entry) =>
                            `${new Date(entry.at).toLocaleTimeString("ru-RU")} ${entry.kind}/${entry.model ?? "—"} ${entry.outcome} ${entry.durationMs}ms${entry.status ? ` HTTP ${entry.status}` : ""}${entry.finishReason ? ` finish=${entry.finishReason}` : ""}${entry.eventCount === undefined ? "" : ` events=${entry.eventCount}`}${entry.contentChunks === undefined ? "" : ` chunks=${entry.contentChunks}`}${entry.malformedEvents ? ` malformed=${entry.malformedEvents}` : ""}${entry.detail ? ` · ${entry.detail}` : ""}`,
                        )
                        .join(" | ")}
                    </dd>
                  </div>
                )}
              </>
            )}
            {proactiveBackoff && (
              <div>
                <dt>Proactive generation backoff</dt>
                <dd>
                  {Math.max(
                    1,
                    Math.ceil((proactiveBackoff.until - Date.now()) / 1000),
                  )}s · failure {proactiveBackoff.failures} ·{" "}
                  {proactiveBackoff.reason}
                </dd>
              </div>
            )}
            <div>
              <dt>След. смолток</dt>
              <dd>
                {settings.proactiveEnabled
                  ? proactiveDebug.nextSmalltalkSec > 0
                    ? `~${proactiveDebug.nextSmalltalkSec} с`
                    : "готова"
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>След. совет</dt>
              <dd>
                {settings.proactiveEnabled
                  ? proactiveDebug.adviceReady
                    ? "готов"
                    : proactiveDebug.nextAdviceLabel
                  : "—"}
              </dd>
            </div>
            {proactiveDebug.adviceBlockReason && !proactiveDebug.adviceReady && (
              <div>
                <dt>Давление cadence</dt>
                <dd>{proactiveDebug.cadencePressure}</dd>
              </div>
            )}
            <div>
              <dt>Движок совета</dt>
              <dd>
                {proactiveDebug.engineStrategy} ·{" "}
                {proactiveDebug.engineReason}
              </dd>
            </div>
            <div>
              <dt>Mood policy</dt>
              <dd>{proactiveDebug.moodPolicy}</dd>
            </div>
            <div>
              <dt>Mood layers</dt>
              <dd>{proactiveDebug.moodLayers}</dd>
            </div>
            <div>
              <dt>Acknowledgement</dt>
              <dd>{proactiveDebug.acknowledgementStatus}</dd>
            </div>
            {proactiveDebug.moodTimeline.length > 0 && (
              <div>
                <dt>Mood timeline</dt>
                <dd>{proactiveDebug.moodTimeline.join(" · ")}</dd>
              </div>
            )}
            <div>
              <dt>Ranker</dt>
              <dd>
                {proactiveDebug.relevanceWinner}
                {proactiveDebug.relevanceScores.length > 0
                  ? ` · ${proactiveDebug.relevanceScores.join(" · ")}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Ranker learning</dt>
              <dd>
                {proactiveDebug.relevanceLearnedEvents > 0
                  ? `${proactiveDebug.relevanceLearnedEvents} events · ${
                      proactiveDebug.relevanceLastUpdate ?? "—"
                    }`
                  : "нет обучающих событий"}
              </dd>
            </div>
            {proactiveDebug.relevanceRecentUpdates.length > 1 && (
              <div>
                <dt>Ranker recent</dt>
                <dd>{proactiveDebug.relevanceRecentUpdates.join(" · ")}</dd>
              </div>
            )}
            {proactiveDebug.engineTrace.length > 0 && (
              <div>
                <dt>Трейс движка</dt>
                <dd>{proactiveDebug.engineTrace.join(" · ")}</dd>
              </div>
            )}
            {proactiveDebug.engineMoveReputation.length > 0 && (
              <div>
                <dt>Move reputation</dt>
                <dd>{proactiveDebug.engineMoveReputation.join(" · ")}</dd>
              </div>
            )}
            <div>
              <dt>Срочность совета</dt>
              <dd>
                {proactiveDebug.adviceUrgencyLevel} · score{" "}
                {proactiveDebug.adviceUrgencyScore} · интервал{" "}
                {proactiveDebug.adviceEffectiveIntervalMin} мин
              </dd>
            </div>
            {proactiveDebug.adviceOutcomeReputation && (
              <div>
                <dt>Advice reputation</dt>
                <dd>{proactiveDebug.adviceOutcomeReputation}</dd>
              </div>
            )}
            <div>
              <dt>Интервал смолтока</dt>
              <dd>{proactiveDebug.smalltalkEffectiveIntervalMin} мин</dd>
            </div>
            {proactiveDebug.adviceUrgencyReasons.length > 0 && (
              <div>
                <dt>Сигналы совета</dt>
                <dd>{proactiveDebug.adviceUrgencyReasons.join(" · ")}</dd>
              </div>
            )}
            <div>
              <dt>Advice / Smalltalk сегодня</dt>
              <dd>
                {proactiveDebug.adviceToday} / {proactiveDebug.smalltalkToday}
              </dd>
            </div>
            <div>
              <dt>Последний bundle</dt>
              <dd>
                {proactiveDebug.lastBundleScore !== null
                  ? `score ${proactiveDebug.lastBundleScore.toFixed(2)} · shouldSend ${
                      proactiveDebug.lastBundleShouldSend ? "да" : "нет"
                    } · source ${proactiveDebug.lastBundleSource ?? "—"}`
                  : "ещё не было"}
              </dd>
            </div>
            {proactiveDebug.lastSynthesisReject && (
              <div>
                <dt>Последний отказ синтеза</dt>
                <dd>{proactiveDebug.lastSynthesisReject}</dd>
              </div>
            )}
            {proactiveDebug.synthesisAttempts.length > 0 && (
              <div>
                <dt>LLM synthesis trace</dt>
                <dd>{proactiveDebug.synthesisAttempts.join(" | ")}</dd>
              </div>
            )}
            {proactiveDebug.lastInitiativeMove && (
              <div>
                <dt>Последний move</dt>
                <dd>{proactiveDebug.lastInitiativeMove}</dd>
              </div>
            )}
            {proactiveDebug.lastPrimaryChain && (
              <div>
                <dt>Primary chain</dt>
                <dd>{proactiveDebug.lastPrimaryChain}</dd>
              </div>
            )}
            <div>
              <dt>Последняя инициатива</dt>
              <dd>
                {getLastProactiveMessageAt()
                  ? new Date(getLastProactiveMessageAt()).toLocaleTimeString(
                      "ru-RU",
                      { hour: "2-digit", minute: "2-digit" },
                    )
                  : "ещё не было"}
              </dd>
            </div>
            {proactiveDebug.lastAdviceDecision && (
              <div>
                <dt>Последнее решение совета</dt>
                <dd>{proactiveDebug.lastAdviceDecision}</dd>
              </div>
            )}
            {proactiveDebug.adviceFinalGate && (
              <div>
                <dt>Advice final gate</dt>
                <dd>{proactiveDebug.adviceFinalGate}</dd>
              </div>
            )}
          </>
        )}
      </dl>

      {proactiveDebug?.lastSuppressions.length ? (
        <p className="settings-note">
          Почему молчала: {proactiveDebug.lastSuppressions.join(" · ")}
        </p>
      ) : (
        <p className="settings-note">
          Если Ari молчит при включённой инициативе — проверьте блок выше и
          подождите 2 мин без ввода в чат.
        </p>
      )}

      {proactiveDebug?.suppressionSummary.length ? (
        <p className="settings-note">
          Частые блокировки:{" "}
          {proactiveDebug.suppressionSummary
            .map((entry) => `${entry.reason} (${entry.count})`)
            .join(" · ")}
        </p>
      ) : null}

      {advisorTopics.length > 0 && (
        <p className="settings-note">
          Темы check-in: {advisorTopics.join(" · ")}
        </p>
      )}
      {signalLines.length > 0 && (
        <ul className="ari-desk-timeline">
          {signalLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {dailyHighlight && (
        <p className="ari-desk-highlight">{dailyHighlight}</p>
      )}
      {weeklyHighlight && (
        <p className="ari-desk-highlight weekly">{weeklyHighlight}</p>
      )}
      {timeline.length > 0 && (
        <ul className="ari-desk-timeline">
          {timeline.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
