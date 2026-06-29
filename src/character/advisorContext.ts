import type { AppSettings } from "../settings/appSettings";
import { loadFocusPreferences } from "./focusPreferences";
import { getActiveFocusSession } from "./focusSession";
import { describeRoutineContext } from "./routines";
import {
  summarizeActivitySignals,
  type ActivitySignalSummary,
} from "../memory/activitySignals";
import {
  summarizeWorkingMemory,
  type WorkingMemorySummary,
} from "../memory/workingMemory";
import { buildDailyReview } from "../memory/reviewAggregator";
import {
  countOpenTasks,
  loadTasks,
} from "../tasks/taskStore";
import {
  inferTaskActivityLink,
  type TaskActivityLink,
} from "../tasks/taskActivityLink";
import {
  parseEditorContext,
  type EditorContext,
} from "../platform/windowContext";

export type AdvisorContext = {
  enabled: boolean;
  now: number;
  sessionMinutes: number;
  windowMinutes: number;
  currentProcess?: string;
  currentTitle?: string;
  editorContext: EditorContext;
  focusPrefs: ReturnType<typeof loadFocusPreferences>;
  activeFocusSession: ReturnType<typeof getActiveFocusSession>;
  openTaskCount: number;
  recentCompletions: string[];
  activitySummary: ActivitySignalSummary;
  workingMemory: WorkingMemorySummary;
  routineHint: string;
  breakDue: boolean;
  stuckScore: number;
  contextThrash: boolean;
  scopeCreep: boolean;
  progressWin: boolean;
  offPeak: boolean;
  repeatedErrorSignature?: string;
  dominantFile?: string;
  dominantRepo?: string;
  topQueryThemes: string[];
  taskActivityLink?: TaskActivityLink | null;
};

function currentTimeBand(hour: number): string {
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function isOffPeak(
  hour: number,
  productiveBands: string[],
): boolean {
  if (!productiveBands.length) {
    return false;
  }
  return !productiveBands.includes(currentTimeBand(hour));
}

function hasRealDailyProgress(done: string[]): boolean {
  return done.some((line) => !/Фокус-сессий сегодня:\s*0/i.test(line));
}

export function buildAdvisorContext(
  settings: AppSettings,
  options: {
    sessionMinutes?: number;
    windowMinutes?: number;
    processName?: string;
    windowTitle?: string;
    now?: number;
  } = {},
): AdvisorContext {
  const now = options.now ?? Date.now();
  const hour = new Date(now).getHours();
  const focusPrefs = loadFocusPreferences();
  const activitySummary = summarizeActivitySignals(now);
  const workingMemory = summarizeWorkingMemory(now);
  const activeFocusSession = getActiveFocusSession();
  const review = buildDailyReview(new Date(now));
  const sessionMinutes = options.sessionMinutes ?? 0;
  const windowMinutes = options.windowMinutes ?? 0;
  const editorContext = options.windowTitle
    ? parseEditorContext(options.windowTitle)
    : {};
  const taskActivityLink = inferTaskActivityLink({
    activitySummary,
    windowTitle: options.windowTitle,
  });

  const recentCompletions = loadTasks({ status: "done", includeDone: true })
    .filter((task) => now - task.updatedAt <= 6 * 60 * 60 * 1000)
    .slice(0, 5)
    .map((task) => task.title);

  const preferredSession = Math.max(
    focusPrefs.bestSessionLengthMinutes,
    focusPrefs.oftenAbandonsAfterMinute ?? 0,
    25,
  );
  const breakDue =
    sessionMinutes >= preferredSession ||
    windowMinutes >= preferredSession ||
    (windowMinutes >= 50 &&
      windowMinutes >= focusPrefs.preferredBreakLengthMinutes * 8);

  const stuckScore = Math.min(
    1,
    (activitySummary.repeatedErrorCount >= 2 ? 0.45 : 0) +
      (activitySummary.longestFileDwellMs >= 45 * 60_000 ? 0.25 : 0) +
      ((activeFocusSession?.blockers?.length ?? 0) > 0 ? 0.15 : 0) +
      (review.stuck.length > 0 ? 0.1 : 0) +
      (focusPrefs.averageCompletionRate < 0.55 ? 0.15 : 0),
  );

  const contextThrash =
    workingMemory.rapidContextSwitches >= 6 ||
    activitySummary.contextChurn >= 5 ||
    workingMemory.windowSwitchCount >= 8;

  const openTaskCount = countOpenTasks();
  const scopeCreep =
    openTaskCount >= 6 &&
    (contextThrash || workingMemory.windowSwitchCount >= 5);

  const progressWin =
    recentCompletions.length > 0 ||
    hasRealDailyProgress(review.done) ||
    Boolean(activeFocusSession?.completed?.length);

  const offPeak = isOffPeak(hour, focusPrefs.productiveTimeBands);

  return {
    enabled: settings.advisorEnabled,
    now,
    sessionMinutes,
    windowMinutes,
    currentProcess: options.processName,
    currentTitle: options.windowTitle,
    editorContext,
    focusPrefs,
    activeFocusSession,
    openTaskCount,
    recentCompletions,
    activitySummary,
    workingMemory,
    routineHint: describeRoutineContext(new Date(now)),
    breakDue,
    stuckScore,
    contextThrash,
    scopeCreep,
    progressWin,
    offPeak,
    repeatedErrorSignature: activitySummary.repeatedErrorSignature,
    dominantFile: activitySummary.dominantFile ?? editorContext.file,
    dominantRepo: activitySummary.dominantRepo ?? editorContext.repo,
    topQueryThemes: activitySummary.topQueryThemes,
    taskActivityLink,
  };
}

export function describeAdvisorFlags(ctx: AdvisorContext): string {
  const flags = [
    ctx.breakDue ? "breakDue" : null,
    ctx.stuckScore >= 0.5 ? `stuck=${ctx.stuckScore.toFixed(2)}` : null,
    ctx.contextThrash ? "contextThrash" : null,
    ctx.scopeCreep ? "scopeCreep" : null,
    ctx.progressWin ? "progressWin" : null,
    ctx.taskActivityLink?.shouldAsk ? "taskLink?" : null,
    ctx.offPeak ? "offPeak" : null,
  ].filter(Boolean);
  return flags.join(", ") || "none";
}
