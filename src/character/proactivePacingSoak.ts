import type { AdviceUrgencyLevel } from "./adviceUrgency";
import {
  ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS,
  proactiveAdviceIntervalMs,
  proactiveSmalltalkIntervalMs,
} from "./initiativeConfig";
import { buildInitiativeSignalBundle } from "./initiativeContext";
import { planProactiveEngineTick } from "./proactiveEngine";
import type { InitiativeSignalBundle } from "./initiativeContext";
import type { AppSettings } from "../settings/appSettings";
import { defaultSettings } from "../settings/appSettings";
import type { ProactiveToneSnapshot } from "../memory/memoryTelemetry";
import {
  canEmitAdviceNow,
  canEmitSmalltalkNow,
  getLastAdviceAttemptAt,
  getLastSmalltalkAttemptAt,
  markAdviceAttemptAt,
  markSmalltalkAttemptAt,
  shouldSuppressOpenChatAdvice,
} from "./proactiveState";

export type ProactiveSoakEventKind =
  | "tick"
  | "smalltalk_sent"
  | "advice_sent"
  | "suppressed";

export type ProactiveSoakEvent = {
  atMs: number;
  kind: ProactiveSoakEventKind;
  reason: string;
  action?: string;
};

export type ProactiveSoakResult = {
  durationMs: number;
  tickMs: number;
  tickCount: number;
  smalltalkSent: number;
  adviceSent: number;
  suppressions: Record<string, number>;
  events: ProactiveSoakEvent[];
};

export type ProactiveSoakInput = {
  settings: AppSettings;
  durationMs?: number;
  tickMs?: number;
  startMs?: number;
  activityAgoMs?: number;
  chatOpen?: boolean;
  llmOnline?: boolean;
  loading?: boolean;
  adviceUrgencyLevel?: AdviceUrgencyLevel;
  bundle?: InitiativeSignalBundle;
  toneSnapshot?: ProactiveToneSnapshot;
  recentAdviceStreak?: number;
};

function defaultToneSnapshot(): ProactiveToneSnapshot {
  return {
    adviceToday: 0,
    smalltalkToday: 0,
    recent: [],
  };
}

function bumpSuppression(
  map: Record<string, number>,
  reason: string,
): void {
  map[reason] = (map[reason] ?? 0) + 1;
}

export function evaluateProactiveSoakTick(input: {
  now: number;
  settings: AppSettings;
  activityAgoMs: number;
  chatOpen: boolean;
  llmOnline: boolean;
  loading: boolean;
  adviceUrgencyLevel: AdviceUrgencyLevel;
  bundle: InitiativeSignalBundle;
  toneSnapshot: ProactiveToneSnapshot;
  recentAdviceStreak: number;
  smalltalkIntervalMs: number;
  adviceIntervalMs: number;
}): {
  outcome: "smalltalk" | "advice" | "silent";
  action: string;
  reason: string;
  suppressReason?: string;
} {
  const activeLevel = input.settings.initiativeLevel === "active";
  const adviceIdleMs = Math.min(2 * 60_000, input.smalltalkIntervalMs);
  const smalltalkIdleMs =
    activeLevel && input.chatOpen
      ? ACTIVE_OPEN_CHAT_SMALLTALK_IDLE_MS
      : adviceIdleMs;

  if (input.loading) {
    return {
      outcome: "silent",
      action: "silent",
      reason: "loading blocks proactive",
      suppressReason: "loading",
    };
  }

  const canEvaluateAdvice = input.activityAgoMs >= adviceIdleMs;
  const canEvaluateSmalltalk = input.activityAgoMs >= smalltalkIdleMs;
  if (!canEvaluateAdvice && !canEvaluateSmalltalk) {
    return {
      outcome: "silent",
      action: "silent",
      reason: `idle gate closed (${Math.round(input.activityAgoMs / 1000)}s < ${Math.round(Math.min(adviceIdleMs, smalltalkIdleMs) / 1000)}s)`,
      suppressReason: "idle_gate",
    };
  }

  const sinceAdviceAttempt = input.now - getLastAdviceAttemptAt();
  const sinceSmalltalkAttempt = input.now - getLastSmalltalkAttemptAt();

  const smalltalkReady =
    canEvaluateSmalltalk &&
    sinceSmalltalkAttempt >= input.smalltalkIntervalMs &&
    canEmitSmalltalkNow(input.settings, input.now);
  const adviceChannelReady =
    canEvaluateAdvice && canEmitAdviceNow(input.settings, input.now);

  const engine = planProactiveEngineTick({
    settings: input.settings,
    bundle: input.bundle,
    urgency: {
      level: input.adviceUrgencyLevel,
      score: input.adviceUrgencyLevel === "high" ? 3 : 1,
      effectiveIntervalMs: input.adviceIntervalMs,
      reasons: ["soak"],
      subjectKey: "soak",
    },
    llmOnline: input.llmOnline,
    idleGateOpen: canEvaluateAdvice,
    loading: input.loading,
    smalltalkReady,
    sinceAdviceAttemptMs: sinceAdviceAttempt,
    adviceIntervalMs: input.adviceIntervalMs,
    toneSnapshot: input.toneSnapshot,
    recentAdviceStreak: input.recentAdviceStreak,
  });

  if (engine.action === "silent") {
    return {
      outcome: "silent",
      action: engine.action,
      reason: engine.reason,
      suppressReason: !smalltalkReady && !input.adviceUrgencyLevel
        ? "not_ready"
        : engine.reason,
    };
  }

  if (engine.action === "try_advice") {
    if (!adviceChannelReady) {
      return {
        outcome: "silent",
        action: engine.action,
        reason: "advice slot chosen but channel blocked",
        suppressReason: "cross_channel_gap_advice",
      };
    }
    if (
      shouldSuppressOpenChatAdvice({
        chatOpen: input.chatOpen,
        activityAgoMs: input.activityAgoMs,
        urgencyLevel: input.adviceUrgencyLevel,
        settings: input.settings,
      })
    ) {
      return {
        outcome: "silent",
        action: engine.action,
        reason: "open chat advice silence",
        suppressReason: "open_chat_advice_silence",
      };
    }
    return {
      outcome: "advice",
      action: engine.action,
      reason: engine.reason,
    };
  }

  if (!smalltalkReady) {
    return {
      outcome: "silent",
      action: engine.action,
      reason: "smalltalk slot chosen but channel not ready",
      suppressReason: smalltalkReady
        ? undefined
        : sinceSmalltalkAttempt < input.smalltalkIntervalMs
          ? "smalltalk_interval"
          : "cross_channel_gap_smalltalk",
    };
  }

  if (!engine.allowSmalltalk) {
    return {
      outcome: "silent",
      action: engine.action,
      reason: "engine blocked smalltalk",
      suppressReason: "engine_blocked_smalltalk",
    };
  }

  return {
    outcome: "smalltalk",
    action: engine.action,
    reason: engine.reason,
  };
}

export function simulateProactiveSoak(input: ProactiveSoakInput): ProactiveSoakResult {
  const durationMs = input.durationMs ?? 10 * 60_000;
  const tickMs = input.tickMs ?? 30_000;
  const startMs = input.startMs ?? 5_000_000;
  const activityAgoMs = input.activityAgoMs ?? 5 * 60_000;
  const chatOpen = input.chatOpen ?? true;
  const llmOnline = input.llmOnline ?? true;
  const loading = input.loading ?? false;
  const adviceUrgencyLevel = input.adviceUrgencyLevel ?? "low";
  const bundle =
    input.bundle ??
    buildInitiativeSignalBundle(input.settings ?? defaultSettings, {
      processName: "Code.exe",
      windowTitle: "ChatPanel.tsx — proactive soak",
      sessionMinutes: 25,
      windowMinutes: 8,
    });
  const toneSnapshot = input.toneSnapshot ?? defaultToneSnapshot();

  const smalltalkIntervalMs = proactiveSmalltalkIntervalMs(input.settings);
  const adviceIntervalMs = proactiveAdviceIntervalMs(input.settings);

  markAdviceAttemptAt(startMs - adviceIntervalMs);
  markSmalltalkAttemptAt(startMs - smalltalkIntervalMs);

  const events: ProactiveSoakEvent[] = [];
  const suppressions: Record<string, number> = {};
  let smalltalkSent = 0;
  let adviceSent = 0;
  let recentAdviceStreak = input.recentAdviceStreak ?? 0;
  const mutableTone: ProactiveToneSnapshot = {
    ...toneSnapshot,
    recent: [...toneSnapshot.recent],
  };

  const tickCount = Math.floor(durationMs / tickMs);
  for (let index = 0; index < tickCount; index += 1) {
    const now = startMs + index * tickMs;
    const verdict = evaluateProactiveSoakTick({
      now,
      settings: input.settings,
      activityAgoMs,
      chatOpen,
      llmOnline,
      loading,
      adviceUrgencyLevel,
      bundle,
      toneSnapshot: mutableTone,
      recentAdviceStreak,
      smalltalkIntervalMs,
      adviceIntervalMs,
    });

    events.push({
      atMs: now - startMs,
      kind: "tick",
      reason: `${verdict.action}: ${verdict.reason}`,
      action: verdict.action,
    });

    if (verdict.outcome === "smalltalk") {
      smalltalkSent += 1;
      recentAdviceStreak = 0;
      mutableTone.smalltalkToday += 1;
      markSmalltalkAttemptAt(now);
      events.push({
        atMs: now - startMs,
        kind: "smalltalk_sent",
        reason: verdict.reason,
        action: verdict.action,
      });
      continue;
    }

    if (verdict.outcome === "advice") {
      adviceSent += 1;
      recentAdviceStreak += 1;
      mutableTone.adviceToday += 1;
      markAdviceAttemptAt(now);
      events.push({
        atMs: now - startMs,
        kind: "advice_sent",
        reason: verdict.reason,
        action: verdict.action,
      });
      continue;
    }

    if (verdict.suppressReason) {
      bumpSuppression(suppressions, verdict.suppressReason);
      events.push({
        atMs: now - startMs,
        kind: "suppressed",
        reason: verdict.reason,
        action: verdict.action,
      });
    }
  }

  return {
    durationMs,
    tickMs,
    tickCount,
    smalltalkSent,
    adviceSent,
    suppressions,
    events,
  };
}

export function formatProactiveSoakReport(result: ProactiveSoakResult): string {
  const lines = [
    `Proactive soak (${Math.round(result.durationMs / 60_000)}m, tick ${result.tickMs / 1000}s)`,
    `Emitted: ${result.smalltalkSent} smalltalk, ${result.adviceSent} advice`,
    `Suppressions: ${
      Object.keys(result.suppressions).length
        ? Object.entries(result.suppressions)
            .map(([reason, count]) => `${reason}=${count}`)
            .join(", ")
        : "none"
    }`,
    "",
    "Timeline:",
  ];

  for (const event of result.events) {
    if (event.kind === "tick") {
      continue;
    }
    const minute = Math.floor(event.atMs / 60_000);
    const second = Math.floor((event.atMs % 60_000) / 1000);
    lines.push(
      `[${minute}:${String(second).padStart(2, "0")}] ${event.kind} — ${event.reason}`,
    );
  }

  return lines.join("\n");
}
