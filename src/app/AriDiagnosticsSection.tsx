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
  getLastProactiveAttemptAt,
  getLastProactiveMessageAt,
} from "../character/proactiveState";
import { getLastAdviceUrgency } from "../character/adviceUrgency";
import { getLastProactiveLlmBundle } from "../character/proactiveLlmEngine";
import {
  dailyInitiativeCap,
  proactiveIntervalMs,
} from "../character/initiativeConfig";
import { getDailyInitiativeCount } from "../character/initiativeScoring";
import { getMemoryHealthSnapshot } from "../memory/memoryTelemetry";
import { isLlmProviderOnline } from "../llm/providerOnline";
import { getGigaChatAuthKeyPresent } from "../llm/gigaChatStatus";

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
  nextCheckInSec: number;
  lastSuppressions: string[];
  adviceUrgencyLevel: string;
  adviceUrgencyScore: number;
  adviceUrgencyReasons: string[];
  adviceEffectiveIntervalMin: number;
  lastBundleScore: number | null;
  lastBundleShouldSend: boolean | null;
  lastInitiativeMove: string | null;
  lastPrimaryChain: string | null;
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
  const intervalMs = proactiveIntervalMs(settings);
  const lastAttempt = getLastProactiveAttemptAt();
  const elapsed = Date.now() - lastAttempt;
  const nextCheckInSec = Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));
  const health = getMemoryHealthSnapshot();
  const isGigaChat = settings.llmProvider === "gigachat";
  const providerOnline = isLlmProviderOnline(settings, null);
  const urgency = getLastAdviceUrgency();
  const lastBundle = getLastProactiveLlmBundle();

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
    nextCheckInSec,
    lastSuppressions: health.lastSuppressions
      .slice(-3)
      .map((entry) => entry.reason),
    adviceUrgencyLevel: urgency?.level ?? "—",
    adviceUrgencyScore: urgency?.score ?? 0,
    adviceUrgencyReasons: urgency?.reasons ?? [],
    adviceEffectiveIntervalMin: urgency
      ? Math.ceil(urgency.effectiveIntervalMs / 60_000)
      : Math.ceil(intervalMs / 60_000),
    lastBundleScore: lastBundle?.usefulnessScore ?? null,
    lastBundleShouldSend: lastBundle ? lastBundle.shouldSend : null,
    lastInitiativeMove: lastBundle?.initiativeMove ?? null,
    lastPrimaryChain:
      lastBundle?.primaryChainSummary ?? lastBundle?.narrativeBrief ?? null,
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
              <dt>След. проверка</dt>
              <dd>
                {settings.proactiveEnabled
                  ? proactiveDebug.nextCheckInSec > 0
                    ? `~${proactiveDebug.nextCheckInSec} с`
                    : "готова"
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Срочность совета</dt>
              <dd>
                {proactiveDebug.adviceUrgencyLevel} · score{" "}
                {proactiveDebug.adviceUrgencyScore} · интервал{" "}
                {proactiveDebug.adviceEffectiveIntervalMin} мин
              </dd>
            </div>
            {proactiveDebug.adviceUrgencyReasons.length > 0 && (
              <div>
                <dt>Сигналы совета</dt>
                <dd>{proactiveDebug.adviceUrgencyReasons.join(" · ")}</dd>
              </div>
            )}
            <div>
              <dt>Последний bundle</dt>
              <dd>
                {proactiveDebug.lastBundleScore !== null
                  ? `score ${proactiveDebug.lastBundleScore.toFixed(2)} · shouldSend ${
                      proactiveDebug.lastBundleShouldSend ? "да" : "нет"
                    }`
                  : "ещё не было"}
              </dd>
            </div>
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
