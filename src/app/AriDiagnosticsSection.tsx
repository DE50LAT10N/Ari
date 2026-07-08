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
import { loadSettings } from "../settings/appSettings";
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
} from "../character/proactiveState";
import {
  getLastAdviceUrgency,
  describeAdviceReadiness,
  computeCadencePressure,
} from "../character/adviceUrgency";
import { describeAdviceFinalGateForDiagnostics } from "../character/adviceFinalGate";
import { describeAdviceEngineForDiagnostics } from "../character/adviceEngine";
import { describeRelevanceRankerForDiagnostics } from "../character/relevanceRanker";
import { getLastProactiveLlmBundle, getLastProactiveSynthesisReject } from "../character/proactiveLlmEngine";
import {
  dailyInitiativeCap,
  proactiveAdviceIntervalMs,
  proactiveSmalltalkIntervalMs,
} from "../character/initiativeConfig";
import { getDailyInitiativeCount } from "../character/initiativeScoring";
import { getMemoryHealthSnapshot, summarizeInitiativeSuppressions } from "../memory/memoryTelemetry";
import { isLlmProviderOnline } from "../llm/providerOnline";
import { getGigaChatAuthKeyPresent } from "../llm/gigaChatStatus";
import { resolveModel } from "../llm/modelRouter";
import {
  formatMoodTimelineForDiagnostics,
  getCurrentMoodLayers,
  moodVectorToPrompt,
} from "../character/moodEngine";
import { getInteractionAcknowledgementSummary } from "../character/interactionAcknowledgement";

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

function buildProactiveDebug(): ProactiveDebug {
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
  const providerOnline = isLlmProviderOnline(settings, null);
  const urgency = getLastAdviceUrgency();
  const lastBundle = getLastProactiveLlmBundle();
  const lastReject = getLastProactiveSynthesisReject();
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

export function AriDiagnosticsSection() {
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
      setProactiveDebug(buildProactiveDebug());
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
  }, []);

  if (!desk) {
    return <p className="settings-note">Загрузка диагностики…</p>;
  }

  const focusActive = Boolean(desk.focusSession && !desk.focusSession.endedAt);
  const settings = loadSettings();
  const gigaKeyPresent = getGigaChatAuthKeyPresent();

  return (
    <div className="ari-diagnostics-section">
      <dl className="ari-desk-list">
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
                  <dd>{resolveModel("json", settings)}</dd>
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
