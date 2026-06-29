import type { ActivitySignalSummary } from "../memory/activitySignals";
import { overlapScore, queryWordSet } from "../memory/memoryScoring";
import { getGoalById } from "./goalLedger";
import { loadTasks, type Task } from "./taskStore";

export type TaskActivityLink = {
  taskId?: string;
  taskTitle?: string;
  goalTitle?: string;
  confidence: "none" | "weak" | "strong";
  reason: string;
  shouldAsk: boolean;
};

function activityText(summary: ActivitySignalSummary, windowTitle?: string): string {
  const recent = summary.recentSignals
    .slice(-8)
    .map((entry) => {
      switch (entry.kind) {
        case "file_focus":
          return [entry.file, entry.repo, entry.title, entry.process].filter(Boolean).join(" ");
        case "query_topic":
          return entry.topic;
        case "clipboard":
          return entry.snippet;
        case "repeated_error":
          return entry.signature;
        default:
          return "";
      }
    });
  return [
    windowTitle,
    summary.dominantFile,
    summary.dominantRepo,
    summary.topQueryThemes.join(" "),
    summary.recentQueryTopics.join(" "),
    ...recent,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1200);
}

function taskText(task: Task): string {
  return [
    task.title,
    task.notes,
    task.category,
    task.metadata ? Object.values(task.metadata).join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function inferTaskActivityLink(input: {
  activitySummary: ActivitySignalSummary;
  windowTitle?: string;
}): TaskActivityLink | null {
  const text = activityText(input.activitySummary, input.windowTitle);
  if (!text.trim()) {
    return null;
  }

  const open = loadTasks({ status: "open" });
  if (!open.length) {
    return null;
  }

  const words = queryWordSet(text);
  const ranked = open
    .map((task, index) => ({
      task,
      score:
        overlapScore(taskText(task), words) +
        (task.goalId ? 0.35 : 0) +
        1 / (index + 8),
    }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best) {
    return null;
  }

  const goalTitle = best.task.goalId ? getGoalById(best.task.goalId)?.title : undefined;
  const anchor =
    input.activitySummary.dominantFile ??
    input.activitySummary.recentQueryTopics[0] ??
    input.windowTitle ??
    "текущая активность";

  if (best.score >= 2) {
    return {
      taskId: best.task.id,
      taskTitle: best.task.title,
      goalTitle,
      confidence: "strong",
      reason: `активность похожа на задачу «${best.task.title}»`,
      shouldAsk: false,
    };
  }

  return {
    taskId: best.task.id,
    taskTitle: best.task.title,
    goalTitle,
    confidence: best.score >= 1 ? "weak" : "none",
    reason: `неясно, относится ли ${anchor} к задаче «${best.task.title}»`,
    shouldAsk: true,
  };
}
