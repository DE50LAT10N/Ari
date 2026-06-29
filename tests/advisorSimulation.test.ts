import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAdvisorContext,
  describeAdvisorFlags,
  type AdvisorContext,
} from "../src/character/advisorContext";
import {
  buildConversationTopics,
  initiativeKindForAngle,
  selectAdvisorAngle,
  type AdvisorAngle,
} from "../src/character/advisorEngine";
import {
  buildInitiativeSignalBundle,
  buildProactiveInitiativePackage,
} from "../src/character/initiativeContext";
import {
  initiativeRiskTolerance,
  proactiveIntervalMs,
} from "../src/character/initiativeConfig";
import { invalidateInitiativeKindCache } from "../src/character/initiativeKinds";
import {
  invalidateInitiativeScoringCache,
  scoreInitiativeLocally,
} from "../src/character/initiativeScoring";
import {
  invalidateProactiveStateCache,
  getRecentProactiveTopics,
  rememberProactiveTopic,
} from "../src/character/proactiveState";
import type { PresenceScene } from "../src/character/presence";
import { defaultSettings, type AppSettings } from "../src/settings/appSettings";
import {
  invalidateActivitySignalsCache,
  recordClipboardSignal,
  recordFileFocus,
  recordQueryTopic,
  summarizeActivitySignals,
} from "../src/memory/activitySignals";
import {
  invalidateWorkingMemoryCache,
  pruneWorkingMemory,
  recordWorkingEvent,
  summarizeWorkingMemory,
} from "../src/memory/workingMemory";
import { addTask, invalidateTaskCache } from "../src/tasks/taskStore";

type ScenarioResult = {
  id: string;
  expected: AdvisorAngle;
  actual: AdvisorAngle | null;
  allowed: boolean;
  value: string;
  risk: string;
  flags: string;
  topics: string[];
  promptPreview: string;
};

type CadenceResult = {
  level: AppSettings["initiativeLevel"];
  configuredMinutes: number;
  effectiveMs: number;
  firstEligibleTickMs: number;
  expectedStart: boolean;
  actualStart: boolean;
  reason: string;
};

type TopicFollowResult = {
  id: string;
  passed: boolean;
  topics: string[];
  reason: string;
};

type Scenario = {
  id: string;
  expected: AdvisorAngle;
  scene?: PresenceScene;
  setup: (now: number) => {
    options?: Parameters<typeof buildAdvisorContext>[1];
    settings?: AppSettings;
  } | void;
};

const report: ScenarioResult[] = [];
const cadenceReport: CadenceResult[] = [];
const topicReport: TopicFollowResult[] = [];

function setupStorage(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => `id-${Math.random().toString(36).slice(2, 10)}`,
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
  });
}

function resetStores(): void {
  setupStorage();
  invalidateActivitySignalsCache();
  invalidateTaskCache();
  invalidateInitiativeKindCache();
  invalidateInitiativeScoringCache();
  invalidateProactiveStateCache();
  invalidateWorkingMemoryCache();
  pruneWorkingMemory();
}

function plannedContext(ctx: AdvisorContext): string {
  const conversationTopics = buildConversationTopics(ctx);
  return [
    "Плановая проверка инициативы после периода тишины.",
    ctx.currentProcess && ctx.currentTitle
      ? `Последнее окно: ${ctx.currentProcess} — ${ctx.currentTitle}`
      : "Контекст окна недоступен.",
    conversationTopics.length
      ? `Возможные темы для живой реплики (выбери одну): ${conversationTopics.join(" | ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function evaluatePlannedStart({
  settings,
  elapsedSinceAttemptMs,
  userActivityAgoMs,
  now = Date.now(),
}: {
  settings: AppSettings;
  elapsedSinceAttemptMs: number;
  userActivityAgoMs: number;
  now?: number;
}): {
  shouldStart: boolean;
  reason: string;
  context: string;
  topics: string[];
} {
  const intervalMs = proactiveIntervalMs(settings);
  const requiredIdleMs = Math.min(2 * 60 * 1000, intervalMs);
  if (elapsedSinceAttemptMs < intervalMs) {
    return {
      shouldStart: false,
      reason: "waiting for proactive interval",
      context: "",
      topics: [],
    };
  }
  if (userActivityAgoMs < requiredIdleMs) {
    return {
      shouldStart: false,
      reason: "waiting for user silence",
      context: "",
      topics: [],
    };
  }

  const bundle = buildInitiativeSignalBundle(settings, {
    now,
    sessionMinutes: Math.round(userActivityAgoMs / 60_000),
    windowMinutes: Math.round(userActivityAgoMs / 60_000),
    processName: "Code.exe",
    windowTitle: "activeWindow.ts - desktop-character - Cursor",
  });
  const recent = getRecentProactiveTopics();
  const topics = buildConversationTopics(bundle.advisor, 5, recent, bundle);
  const pkg = buildProactiveInitiativePackage(settings, "check_in", {
    now,
    sessionMinutes: Math.round(userActivityAgoMs / 60_000),
    windowMinutes: Math.round(userActivityAgoMs / 60_000),
    processName: "Code.exe",
    windowTitle: "activeWindow.ts - desktop-character - Cursor",
    conversationTopics: topics,
  });
  const context = pkg.eventDescription;
  const freshTopics = topics.length > 0 || bundle.hasActionableSignals;
  const decision = scoreInitiativeLocally({
    description: context,
    scene: "idle",
    chatClosedAgoMs: 60 * 60_000,
    userActivityAgoMs,
    dailyCap: 99,
    riskTolerance: initiativeRiskTolerance(settings),
    plannedCheckMinSilenceMs: intervalMs,
    adaptiveEnabled: false,
    plannedCheckFreshTopics: freshTopics,
  });
  return {
    shouldStart: decision.allowed,
    reason: decision.reason,
    context,
    topics,
  };
}

function runScenario(scenario: Scenario): ScenarioResult {
  const now = Date.now();
  const settings = {
    ...defaultSettings,
    advisorEnabled: true,
    proactiveEnabled: true,
    activityTrackingEnabled: true,
    initiativeLevel: "active" as const,
    proactiveIntervalMinutes: 1,
  };
  const setupResult = scenario.setup(now) ?? {};
  const mergedSettings = setupResult.settings ?? settings;
  const ctx = buildAdvisorContext(mergedSettings, {
    now,
    ...setupResult.options,
  });
  const actual = selectAdvisorAngle(ctx);
  const bundle = buildInitiativeSignalBundle(mergedSettings, {
    now,
    ...setupResult.options,
  });
  const topics = buildConversationTopics(
    bundle.advisor,
    5,
    getRecentProactiveTopics(),
    bundle,
  );
  const prompt = actual
    ? buildProactiveInitiativePackage(
        mergedSettings,
        initiativeKindForAngle(actual),
        {
          now,
          ...setupResult.options,
          advisorAngle: actual,
          conversationTopics: topics,
        },
      ).eventDescription
    : "";
  const decision = scoreInitiativeLocally({
    description: prompt,
    scene: scenario.scene ?? "idle",
    chatClosedAgoMs: 60 * 60_000,
    userActivityAgoMs: Math.max(2 * 60_000, proactiveIntervalMs(mergedSettings)),
    dailyCap: 99,
    riskTolerance: 1,
    plannedCheckMinSilenceMs: proactiveIntervalMs(mergedSettings),
    adaptiveEnabled: false,
  });

  return {
    id: scenario.id,
    expected: scenario.expected,
    actual,
    allowed: decision.allowed,
    value: decision.value,
    risk: decision.annoyanceRisk,
    flags: describeAdvisorFlags(ctx),
    topics: buildConversationTopics(ctx),
    promptPreview: prompt
      .replace(/\s+/g, " ")
      .slice(0, 220)
      .trim(),
  };
}

function writeReport(results: ScenarioResult[]): void {
  const target = path.resolve(
    process.cwd(),
    "docs",
    "ADVISOR_SIMULATION_REPORT.md",
  );
  const lines = [
    "# Ari advisor simulation report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Scenario | Expected | Actual | Initiative | Value/Risk | Flags | Topics |",
    "|----------|----------|--------|------------|------------|-------|--------|",
    ...results.map(
      (result) =>
        `| ${result.id} | ${result.expected} | ${result.actual ?? "none"} | ${
          result.allowed ? "allowed" : "blocked"
        } | ${result.value}/${result.risk} | ${result.flags || "none"} | ${
          result.topics.join("; ") || "none"
        } |`,
    ),
    "",
    "## Prompt previews",
    "",
    ...results.flatMap((result) => [
      `### ${result.id}`,
      "",
      result.promptPreview || "(no prompt)",
      "",
    ]),
    "## Proactive cadence",
    "",
    "| Level | Configured | Effective interval | First check tick | Starts | Reason |",
    "|-------|------------|--------------------|------------------|--------|--------|",
    ...cadenceReport.map(
      (result) =>
        `| ${result.level} | ${result.configuredMinutes} min | ${Math.round(
          result.effectiveMs / 1000,
        )} sec | ${Math.round(result.firstEligibleTickMs / 1000)} sec | ${
          result.actualStart ? "yes" : "no"
        } | ${result.reason} |`,
    ),
    "",
    "## Topic following",
    "",
    "| Check | Result | Topics | Reason |",
    "|-------|--------|--------|--------|",
    ...topicReport.map(
      (result) =>
        `| ${result.id} | ${result.passed ? "pass" : "fail"} | ${
          result.topics.join("; ") || "none"
        } | ${result.reason} |`,
    ),
  ];
  fs.writeFileSync(target, lines.join("\n"), "utf8");
}

const scenarios: Scenario[] = [
  {
    id: "long_session_rest",
    expected: "rest",
    setup: () => ({
      options: {
        sessionMinutes: 55,
        windowMinutes: 55,
        processName: "Code.exe",
        windowTitle: "ChatPanel.tsx - desktop-character - Cursor",
      },
    }),
  },
  {
    id: "repeated_stacktrace_debug",
    expected: "debug_help",
    setup: (now) => {
      recordClipboardSignal({
        clipKind: "stacktrace",
        snippet: "Error: failed to load model\n at ChatPanel.tsx:2144",
        at: now - 90_000,
      });
      recordClipboardSignal({
        clipKind: "stacktrace",
        snippet: "Error: failed to load model\n at ChatPanel.tsx:2144",
        at: now - 30_000,
      });
      recordFileFocus({
        process: "Code.exe",
        file: "ChatPanel.tsx",
        repo: "desktop-character",
        dwellMs: 50 * 60_000,
        at: now,
      });
      return {
        options: {
          sessionMinutes: 15,
          windowMinutes: 15,
          processName: "Code.exe",
          windowTitle: "ChatPanel.tsx - desktop-character - Cursor",
        },
      };
    },
  },
  {
    id: "rapid_switch_refocus",
    expected: "refocus",
    setup: (now) => {
      for (let index = 0; index < 8; index += 1) {
        recordWorkingEvent({
          kind: "window_switch",
          app: `app-${index}`,
          title: `window-${index}`,
          topic: `switch ${index}`,
          at: now - index * 20_000,
        });
      }
      recordQueryTopic({ topic: "react state cleanup", source: "chat", at: now });
      return {
        options: {
          sessionMinutes: 15,
          windowMinutes: 5,
          processName: "Code.exe",
          windowTitle: "state.ts - desktop-character - Cursor",
        },
      };
    },
  },
  {
    id: "many_open_tasks_scope",
    expected: "scope",
    setup: (now) => {
      for (let index = 0; index < 7; index += 1) {
        addTask({
          title: `Open task ${index + 1}`,
          kind: "task",
          status: "open",
          priority: "normal",
          source: "user",
        });
      }
      for (let index = 0; index < 5; index += 1) {
        recordWorkingEvent({
          kind: "window_switch",
          app: `tool-${index}`,
          topic: `task context ${index}`,
          at: now - index * 75_000,
        });
      }
      return {
        options: {
          sessionMinutes: 20,
          windowMinutes: 10,
          processName: "Code.exe",
          windowTitle: "roadmap.md - desktop-character - Cursor",
        },
      };
    },
  },
  {
    id: "recent_topic_check_in",
    expected: "topic",
    setup: (now) => {
      recordQueryTopic({
        topic: "Tauri active window permissions",
        source: "browser",
        at: now,
      });
      recordFileFocus({
        process: "Code.exe",
        file: "activeWindow.ts",
        repo: "desktop-character",
        dwellMs: 4 * 60_000,
        at: now,
      });
      return {
        options: {
          sessionMinutes: 10,
          windowMinutes: 4,
          processName: "Code.exe",
          windowTitle: "activeWindow.ts - desktop-character - Cursor",
        },
      };
    },
  },
];

describe("advisor simulation", () => {
  beforeEach(() => {
    resetStores();
  });

  for (const scenario of scenarios) {
    it(`simulates ${scenario.id}`, () => {
      const result = runScenario(scenario);
      report.push(result);
      expect(result.actual).toBe(scenario.expected);
      expect(result.allowed).toBe(true);
      expect(result.promptPreview.length).toBeGreaterThan(20);
    });
  }

  it("summarizes collected signal stores", () => {
    resetStores();
    const now = Date.now();
    recordClipboardSignal({
      clipKind: "code",
      snippet: "const token = 'secret';",
      at: now,
    });
    recordFileFocus({
      process: "Code.exe",
      file: "advisorSimulation.test.ts",
      repo: "desktop-character",
      dwellMs: 3 * 60_000,
      at: now,
    });
    recordWorkingEvent({
      kind: "window_switch",
      app: "Code.exe",
      topic: "Working on advisor simulation",
      at: now,
    });

    expect(summarizeActivitySignals(now).dominantFile).toBe(
      "advisorSimulation.test.ts",
    );
    expect(summarizeWorkingMemory(now).distinctApps).toContain("Code.exe");
  });

  it("simulates proactive conversation cadence by initiative level", () => {
    const tickMs = 15_000;
    const cases: Array<{
      level: AppSettings["initiativeLevel"];
      expectedStart: boolean;
    }> = [
      { level: "active", expectedStart: true },
      { level: "balanced", expectedStart: true },
      { level: "rare", expectedStart: true },
      { level: "silent", expectedStart: false },
    ];

    for (const item of cases) {
      resetStores();
      const settings = {
        ...defaultSettings,
        advisorEnabled: true,
        proactiveEnabled: true,
        activityTrackingEnabled: true,
        initiativeLevel: item.level,
        proactiveIntervalMinutes: 1,
      };
      const effectiveMs = proactiveIntervalMs(settings);
      const firstEligibleTickMs = Math.ceil(effectiveMs / tickMs) * tickMs;
      const before = evaluatePlannedStart({
        settings,
        elapsedSinceAttemptMs: Math.max(0, firstEligibleTickMs - tickMs),
        userActivityAgoMs: firstEligibleTickMs,
      });
      const atTick = evaluatePlannedStart({
        settings,
        elapsedSinceAttemptMs: firstEligibleTickMs,
        userActivityAgoMs: firstEligibleTickMs,
      });

      cadenceReport.push({
        level: item.level,
        configuredMinutes: 1,
        effectiveMs,
        firstEligibleTickMs,
        expectedStart: item.expectedStart,
        actualStart: atTick.shouldStart,
        reason: atTick.reason,
      });

      expect(before.shouldStart).toBe(false);
      expect(atTick.shouldStart).toBe(item.expectedStart);
    }
  });

  it("keeps planned check-ins attached to recent work topics", () => {
    const now = Date.now();
    const settings = {
      ...defaultSettings,
      advisorEnabled: true,
      proactiveEnabled: true,
      activityTrackingEnabled: true,
      initiativeLevel: "balanced" as const,
      proactiveIntervalMinutes: 1,
    };
    recordQueryTopic({
      topic: "Tauri active window permissions",
      source: "browser",
      at: now,
    });
    recordFileFocus({
      process: "Code.exe",
      file: "activeWindow.ts",
      repo: "desktop-character",
      dwellMs: 4 * 60_000,
      at: now,
    });

    const result = evaluatePlannedStart({
      settings,
      elapsedSinceAttemptMs: proactiveIntervalMs(settings),
      userActivityAgoMs: proactiveIntervalMs(settings),
      now,
    });
    const contextHasTopic =
      result.context.includes("Tauri active window permissions") &&
      result.context.includes("activeWindow.ts");
    topicReport.push({
      id: "planned_check_uses_recent_topics",
      passed: result.shouldStart && contextHasTopic,
      topics: result.topics,
      reason: result.reason,
    });

    expect(result.shouldStart).toBe(true);
    expect(result.topics.join(" ")).toContain(
      "Tauri active window permissions",
    );
    expect(result.topics.join(" ")).toContain("activeWindow.ts");
    expect(contextHasTopic).toBe(true);
  });

  it("still offers file topic when browser query was recently proactive", () => {
    const now = Date.now();
    const settings = {
      ...defaultSettings,
      advisorEnabled: true,
      proactiveEnabled: true,
      activityTrackingEnabled: true,
      initiativeLevel: "balanced" as const,
      proactiveIntervalMinutes: 1,
    };
    recordQueryTopic({
      topic: "Tauri active window permissions",
      source: "browser",
      at: now,
    });
    recordFileFocus({
      process: "Code.exe",
      file: "activeWindow.ts",
      repo: "desktop-character",
      dwellMs: 4 * 60_000,
      at: now,
    });
    rememberProactiveTopic(
      "Studio — Личный кабинет технологических продуктов Сбера",
    );

    const result = evaluatePlannedStart({
      settings,
      elapsedSinceAttemptMs: proactiveIntervalMs(settings),
      userActivityAgoMs: proactiveIntervalMs(settings),
      now,
    });
    topicReport.push({
      id: "repeat_guard_rotates_to_file_topic",
      passed: result.shouldStart,
      topics: result.topics,
      reason: result.reason,
    });

    expect(result.topics.some((topic) => /activeWindow|как идёт/i.test(topic))).toBe(
      true,
    );
    expect(result.shouldStart).toBe(true);
  });
});

afterAll(() => {
  writeReport(report);
});
