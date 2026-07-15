import type { AppSettings } from "../settings/appSettings";
import { defaultSettings } from "../settings/appSettings";

function onOff(enabled: boolean): string {
  return enabled ? "on" : "off";
}

export function buildCapabilitiesOverview(
  settings: AppSettings = defaultSettings,
): string {
  const provider =
    settings.llmProvider === "gigachat" ? "GigaChat API" : "Ollama (local)";

  const sections: string[] = [
    "=== Chat & personality ===",
    `• Provider: ${provider}`,
    "• Streaming replies with stop, regenerate, clear history (with confirm)",
    "• Emotion tags per message; 17 sprite emotions + reaction overlays",
    "• Response modes: casual, technical, emotional, vision, reminder, initiative, etc.",
    `• Tone: ${settings.ariTone}, warmth: ${settings.warmthLevel}, teasing: ${settings.teasingLevel}`,
    "• Hidden mood + relationship bond affect tone and initiative",
    "• Teach Ari mode: save behaviour rules from chat",
    "",
    "=== Memory (your config) ===",
    `• Long-term facts: ${onOff(settings.userMemoryEnabled)}`,
    "• Episodes, open threads, consolidation at 100 facts",
    `• RAG documents: ${onOff(settings.ragEnabled)} (embedding: ${settings.embeddingSource})`,
    `• Smart retrieval: MMR ${onOff(settings.rerankEnabled)}, LLM rerank ${onOff(settings.llmRerankEnabled)}`,
    "• Memory inbox for low-confidence facts; conflict resolution",
    "",
    "=== Context & vision ===",
    `• Active window (process + title): ${onOff(settings.activityTrackingEnabled)}`,
    `• Programmer advisor (activity signals): ${onOff(settings.advisorEnabled)}`,
    `• IDE Advisor (VS Code): ${onOff(settings.ideAdvisorEnabled)} (code context: ${onOff(settings.adviceCodeReadingEnabled)})`,
    `• Full clipboard capture (redacted, local): ${onOff(settings.clipboardFullCaptureEnabled)}`,
    `• Clipboard error notes: ${onOff(settings.clipboardObservationEnabled)}`,
    `• Screen glance / OCR / compare: vision via ${settings.visionSource}`,
    `• Visual memory text: ${settings.visualMemoryMinutes} min (no image kept)`,
    `• Auto vision glance: ${onOff(settings.autoVisionEnabled)}`,
    `• Web tools (search/fetch): ${onOff(settings.webToolsEnabled)}`,
    "",
    "=== Initiative & companion ===",
    `• Proactive messages: ${onOff(settings.proactiveEnabled)}`,
    `• Level: ${settings.initiativeLevel}, smalltalk ~${settings.proactiveSmalltalkIntervalMinutes} min, advice ~${settings.proactiveAdviceIntervalMinutes} min, no hard daily cap`,
    `• Event reactions (window switch, long session): ${onOff(settings.eventReactionsEnabled)}`,
    `• Reminders: ${onOff(settings.remindersEnabled)}`,
    `• Quiet hours: ${settings.quietHoursStart}:00–${settings.quietHoursEnd}:00`,
    `• Adaptive initiative learning: ${onOff(settings.adaptiveInitiativeEnabled)}`,
    "• Ambient bubbles when chat closed; LLM-only micro-thoughts; scenario packs",
    "",
    "=== Tasks, focus, pomodoro ===",
    "• Goal ledger: current goal, progress %, and focus notes above tasks",
    `• Unified task board beside avatar (when chat closed)`,
    `• Pomodoro: ${onOff(settings.pomodoroEnabled)} (${settings.pomodoroFocusMinutes}/${settings.pomodoroBreakMinutes} min)`,
    "• Focus sessions: goal, step, blockers, subtasks",
    "• Project binder + read-only git companion",
    "",
    "=== Safe actions ===",
    `• Confirmed actions only: ${onOff(settings.safeActionsEnabled)}`,
    "• Open URL, open file/folder, clipboard copy, create note",
    "",
    "=== Voice & UI ===",
    `• Blip voice: ${settings.voiceStyle === "blip" ? "on" : "off"}`,
    `• UI sounds: ${onOff(settings.soundsEnabled)}`,
    `• Avatar liveliness: ${onOff(settings.avatarLivelinessEnabled)}`,
    "• System tray, autostart, window drag/resize, backup ZIP export",
    "",
    "=== Chat commands (examples) ===",
    "• Goals: «добавь цель …», «цели», «фокус на цель …», «прогресс цели … 35%»",
    "• Tasks: «добавь задачу …», «список задач», «сделано: …», «напомни …»",
    "• Focus: «старт фокуса: …», «стоп фокус», «фокус: шаг …»",
    "• Reviews: «daily review», «weekly review»",
    "• Git (read-only): «git status», «git log», «git diff»",
    "• «что ты умеешь» / help — this overview",
    "",
    "Full command list: docs/COMMANDS.md",
    "Architecture & ML details: docs/ in the project folder.",
  ];

  return sections.join("\n");
}
