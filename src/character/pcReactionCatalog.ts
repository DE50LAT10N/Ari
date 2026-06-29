import type { CharacterEmotion } from "../types/character";
import type { InitiativeKind } from "./initiativeKinds";
import type { SilentReactionKind } from "./silentReactions";
import {
  overlayDurationMs,
  REACTION_AMBIENT_MS,
  REACTION_OVERLAY_MS,
} from "./reactionTiming";

export type PcEventKind =
  | "build_success"
  | "build_fail"
  | "window_switch"
  | "long_focus"
  | "return_from_idle"
  | "error_detected";

export type PcReactionPlan = {
  event: PcEventKind;
  silentReaction?: SilentReactionKind;
  initiativeKind?: InitiativeKind;
  emotion: CharacterEmotion;
  overlay: "thinking" | "question" | "surprise" | "sparkles" | "anger";
  thought?: string;
  cooldownMs: number;
  spokenHint?: string;
  allowWhenChatOpen: boolean;
  priority: number;
};

const EVENT_PRIORITY: Record<PcEventKind, number> = {
  error_detected: 90,
  build_fail: 85,
  build_success: 70,
  return_from_idle: 60,
  window_switch: 40,
  long_focus: 30,
};

const catalog: Record<PcEventKind, PcReactionPlan> = {
  build_success: {
    event: "build_success",
    silentReaction: "build_success",
    emotion: "happy",
    overlay: "sparkles",
    thought: "*сборка прошла — кивает одобрительно*",
    cooldownMs: 18 * 60_000,
    spokenHint: "Сборка прошла — коротко отметь успех без пафоса.",
    allowWhenChatOpen: false,
    priority: EVENT_PRIORITY.build_success,
  },
  build_fail: {
    event: "build_fail",
    silentReaction: "build_failed",
    emotion: "surprised",
    overlay: "surprise",
    thought: "*заметила ошибку в заголовке окна*",
    cooldownMs: 12 * 60_000,
    spokenHint: "Сборка упала — коротко отметь и предложи глянуть лог.",
    allowWhenChatOpen: false,
    initiativeKind: "context_comment",
    priority: EVENT_PRIORITY.build_fail,
  },
  window_switch: {
    event: "window_switch",
    initiativeKind: "context_comment",
    emotion: "curious",
    overlay: "question",
    thought: "*переключился контекст*",
    cooldownMs: 20 * 60_000,
    spokenHint: "Долго работал в одном окне и переключился — мягко отметь смену контекста.",
    allowWhenChatOpen: true,
    priority: EVENT_PRIORITY.window_switch,
  },
  long_focus: {
    event: "long_focus",
    initiativeKind: "break_suggestion",
    emotion: "calm",
    overlay: "thinking",
    thought: "*тихо рядом, не мешает*",
    cooldownMs: 45 * 60_000,
    spokenHint: "Долгий фокус — короткая поддержка без давления.",
    allowWhenChatOpen: false,
    priority: EVENT_PRIORITY.long_focus,
  },
  return_from_idle: {
    event: "return_from_idle",
    silentReaction: "return",
    initiativeKind: "return_reaction",
    emotion: "curious",
    overlay: "thinking",
    thought: "*вернулся после паузы*",
    cooldownMs: 10 * 60_000,
    spokenHint: "Вернулся после паузы — естественно отметь возвращение.",
    allowWhenChatOpen: true,
    priority: EVENT_PRIORITY.return_from_idle,
  },
  error_detected: {
    event: "error_detected",
    silentReaction: "error_detected",
    emotion: "surprised",
    overlay: "surprise",
    thought: "*что-то пошло не так*",
    cooldownMs: 10 * 60_000,
    spokenHint: "В окне ошибка — коротко отметь без драматизации.",
    allowWhenChatOpen: false,
    initiativeKind: "context_comment",
    priority: EVENT_PRIORITY.error_detected,
  },
};

const lastTriggered = new Map<PcEventKind, number>();
const GLOBAL_COOLDOWN_MS = 45_000;
let lastAnyReactionAt = 0;

export function getPcReactionPlan(kind: PcEventKind): PcReactionPlan {
  return catalog[kind];
}

export function getPcReactionVisualDuration(plan: PcReactionPlan): number {
  return plan.silentReaction
    ? overlayDurationMs(plan.overlay)
    : REACTION_OVERLAY_MS;
}

export { REACTION_AMBIENT_MS, REACTION_OVERLAY_MS };

export function canTriggerPcReaction(
  kind: PcEventKind,
  options: { chatOpen: boolean },
): boolean {
  const plan = catalog[kind];
  if (!plan.allowWhenChatOpen && options.chatOpen) {
    return false;
  }
  if (Date.now() - lastAnyReactionAt < GLOBAL_COOLDOWN_MS) {
    return false;
  }
  const last = lastTriggered.get(kind) ?? 0;
  return Date.now() - last >= plan.cooldownMs;
}

export function markPcReactionTriggered(kind: PcEventKind): void {
  lastTriggered.set(kind, Date.now());
  lastAnyReactionAt = Date.now();
}

export function consumePcReaction(
  kind: PcEventKind,
  options: { chatOpen: boolean },
): PcReactionPlan | null {
  if (!canTriggerPcReaction(kind, options)) {
    return null;
  }
  markPcReactionTriggered(kind);
  return getPcReactionPlan(kind);
}

export function resolvePcReaction(
  candidates: PcEventKind[],
  options: { chatOpen: boolean },
): PcReactionPlan | null {
  const eligible = candidates
    .filter((kind) => canTriggerPcReaction(kind, options))
    .sort(
      (left, right) => catalog[right].priority - catalog[left].priority,
    );
  const winner = eligible[0];
  if (!winner) {
    return null;
  }
  markPcReactionTriggered(winner);
  return getPcReactionPlan(winner);
}

export function detectNonBuildPcError(
  processName: string,
  windowTitle: string,
): PcEventKind | null {
  if (!/(code|devenv|idea|pycharm|webstorm|rustrover|terminal|powershell|cmd)/i.test(processName)) {
    return null;
  }
  const title = windowTitle.toLowerCase();
  if (/(build failed|build succeeded|tests passed|0 errors)/i.test(title)) {
    return null;
  }
  if (/(error|exception|ошибк|failed|traceback|panic)/i.test(title)) {
    return "error_detected";
  }
  return null;
}

export function mapBuildScenario(
  scenario: "build_succeeded" | "build_failed",
): PcEventKind {
  return scenario === "build_succeeded" ? "build_success" : "build_fail";
}
