import type { AppSettings } from "../settings/appSettings";
import { searchRag } from "../rag/ragClient";
import { planAdvice } from "./advicePlanner";
import { evaluateAdviceNovelty, adviceEntryText } from "./adviceNovelty";
import {
  buildAdviceTopicKey,
  getRecentAdviceFeedback,
  loadAdviceLedger,
} from "./adviceLedger";
import {
  buildAdviceObservedState,
  getRecentAdviceOutcomes,
  reconcilePendingAdviceOutcomes,
} from "./adviceOutcome";
import {
  computeCadencePressure,
  planSignalDrivenAdvice,
  type AdviceUrgency,
} from "./adviceUrgency";
import { hasActionableAdvisorSignals, pickPlannedInitiativeAnchor } from "./advisorEngine";
import {
  buildProactiveInitiativePackage,
  collectBannedProactiveTopics,
  type InitiativeSignalBundle,
  type ProactiveInitiativePackage,
  type ProactivePackageOptions,
} from "./initiativeContext";
import {
  buildGateContextFromBundle,
  collectProactiveSignalFacts,
  isThinAdviceContext,
  synthesizeProactiveBundle,
  type ProactiveLlmBundle,
  type ProactiveSignalFact,
} from "./proactiveLlmEngine";
import {
  buildFactLinkGraph,
  inferTopicChains,
  type ProactiveTopicChain,
} from "./proactiveTopicLinker";
import {
  buildProactiveWebSearchQuery,
  hasProactiveDebugSignals,
} from "./proactiveTone";
import { loadCurrentCodeExcerpt } from "./codeContext";

export type AdviceStrategy =
  | "FRESH_ADVICE"
  | "ROTATE_TOPIC"
  | "CLARIFY"
  | "DEFER_SMALLTALK"
  | "SILENT";

export type AdviceTraceStep = {
  stage: string;
  detail: string;
};

export type AdviceContext = {
  settings: AppSettings;
  bundle: InitiativeSignalBundle;
  urgency: AdviceUrgency;
  packageOptions: ProactivePackageOptions;
  llmOnline: boolean;
  advisorEnabled: boolean;
  sinceAdviceAttemptMs: number;
  adviceIntervalMs: number;
  now: number;
  safety: {
    idleGateOpen: boolean;
    loading: boolean;
  };
  plan: ReturnType<typeof planSignalDrivenAdvice>;
  facts: ProactiveSignalFact[];
  topicChains: ProactiveTopicChain[];
  banned: string[];
  candidateTopics: string[];
  preliminaryAnchor: string;
  hasActionableSignals: boolean;
  cadencePressure: ReturnType<typeof computeCadencePressure>;
};

export type AdviceDecision = {
  strategy: AdviceStrategy;
  deliver: boolean;
  trace: AdviceTraceStep[];
  package: ProactiveInitiativePackage | null;
  bundle: ProactiveLlmBundle | null;
  reason: string;
  engineApproved: boolean;
};

const TRACE_KEY = "desktop-character.advice-trace.v1";

let lastTraceSnapshot: AdviceDecision | null = null;

function pushTrace(
  trace: AdviceTraceStep[],
  stage: string,
  detail: string,
): void {
  trace.push({ stage, detail });
}

export function resetAdviceEngineForTests(): void {
  lastTraceSnapshot = null;
  localStorage.removeItem(TRACE_KEY);
}

export function getLastAdviceDecisionTrace(): AdviceDecision | null {
  if (lastTraceSnapshot) {
    return lastTraceSnapshot;
  }
  try {
    const raw = localStorage.getItem(TRACE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AdviceDecision;
  } catch {
    return null;
  }
}

function persistAdviceTrace(decision: AdviceDecision): void {
  lastTraceSnapshot = decision;
  try {
    localStorage.setItem(
      TRACE_KEY,
      JSON.stringify({
        strategy: decision.strategy,
        deliver: decision.deliver,
        trace: decision.trace,
        reason: decision.reason,
        engineApproved: decision.engineApproved,
        bundleScore: decision.bundle?.usefulnessScore ?? null,
        bundleShouldSend: decision.bundle?.shouldSend ?? null,
        at: Date.now(),
      }),
    );
    window.dispatchEvent(new Event("ari-proactive-state-changed"));
  } catch {
    // ignore persistence errors
  }
}

export function gatherAdviceContext(input: {
  settings: AppSettings;
  bundle: InitiativeSignalBundle;
  urgency: AdviceUrgency;
  packageOptions: ProactivePackageOptions;
  llmOnline: boolean;
  advisorEnabled: boolean;
  sinceAdviceAttemptMs: number;
  adviceIntervalMs: number;
  now?: number;
  safety: { idleGateOpen: boolean; loading: boolean };
}): AdviceContext {
  const now = input.now ?? Date.now();
  const banned = collectBannedProactiveTopics();
  const plan = planSignalDrivenAdvice(input.bundle, input.urgency, banned);
  const candidateTopics =
    input.packageOptions.conversationTopics ?? plan.conversationTopics;
  const preliminaryAnchor =
    pickPlannedInitiativeAnchor(candidateTopics, {
      recentProactive: banned,
      windowTitle: input.packageOptions.windowTitle,
      dominantFile: input.bundle.editorFile,
    }) ?? plan.anchor ?? candidateTopics[0] ?? "";
  const facts = collectProactiveSignalFacts({
    bundle: input.bundle,
    tone: "advice",
    bannedTopics: banned,
    candidateTopics,
    sessionMinutes: input.packageOptions.sessionMinutes,
    windowMinutes: input.packageOptions.windowMinutes,
    companionSilenceMs: input.packageOptions.companionSilenceMs,
    recentUserMessage: input.packageOptions.recentUserMessage,
    urgency: input.urgency,
    recentChatTurns: input.packageOptions.recentChatTurns,
    codeExcerpts: input.packageOptions.proactiveIdeExcerpts,
  });
  const graph = buildFactLinkGraph(facts, input.bundle);
  const topicChains = inferTopicChains(graph, facts, 2);
  const cadencePressure = computeCadencePressure(
    input.urgency,
    input.sinceAdviceAttemptMs,
    now,
    input.adviceIntervalMs,
  );

  return {
    settings: input.settings,
    bundle: input.bundle,
    urgency: input.urgency,
    packageOptions: input.packageOptions,
    llmOnline: input.llmOnline,
    advisorEnabled: input.advisorEnabled,
    sinceAdviceAttemptMs: input.sinceAdviceAttemptMs,
    adviceIntervalMs: input.adviceIntervalMs,
    now,
    safety: input.safety,
    plan,
    facts,
    topicChains,
    banned,
    candidateTopics,
    preliminaryAnchor,
    hasActionableSignals:
      input.bundle.hasActionableSignals ||
      hasActionableAdvisorSignals(input.bundle.advisor) ||
      input.urgency.level !== "none",
    cadencePressure,
  };
}

function rotateConversationTopics(ctx: AdviceContext): string[] {
  const recentAnchors = new Set(
    loadAdviceLedger(ctx.now)
      .filter((entry) => entry.tone === "advice")
      .slice(0, 6)
      .map((entry) => (entry.anchor ?? entry.signalSummary ?? "").toLowerCase())
      .filter(Boolean),
  );
  const rotated: string[] = [];
  const seen = new Set<string>();

  const push = (topic?: string) => {
    const trimmed = topic?.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key) || recentAnchors.has(key)) {
      return;
    }
    seen.add(key);
    rotated.push(trimmed);
  };

  for (const chain of ctx.topicChains) {
    for (const link of chain.links) {
      const from = ctx.facts.find((fact) => fact.id === link.fromFactId);
      const to = ctx.facts.find((fact) => fact.id === link.toFactId);
      push(from?.detail);
      push(to?.detail);
      push(link.label);
    }
    push(chain.summarySeed);
  }

  for (const fact of ctx.facts) {
    if (["query", "clipboard", "wm", "urgency", "task"].includes(fact.kind)) {
      push(fact.detail);
    }
  }

  for (const topic of ctx.candidateTopics) {
    push(topic);
  }

  return rotated.length > 0 ? rotated.slice(0, 5) : ctx.candidateTopics;
}

const CADENCE_REPEAT_REASON =
  /серия|якорь|перекос/i;

function cadencePressureFromRepeat(ctx: AdviceContext): boolean {
  return ctx.cadencePressure.reasons.some((reason) =>
    CADENCE_REPEAT_REASON.test(reason),
  );
}

function recentClarifyingEntries(now = Date.now()): ReturnType<typeof loadAdviceLedger> {
  return loadAdviceLedger(now).filter(
    (entry) =>
      entry.tone === "advice" &&
      now - entry.at <= 45 * 60_000 &&
      entry.adviceCandidateKind === "clarifying_probe",
  );
}

function hasRecentClarifyingOnFile(
  fileDetail: string | undefined,
  now = Date.now(),
): boolean {
  const fileKey = (fileDetail ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, " ")
    .trim();
  if (!fileKey) {
    return false;
  }
  const fileStem = fileKey.split(/[\\/]/).pop() ?? fileKey;
  return recentClarifyingEntries(now).some((entry) => {
    const text = adviceEntryText(entry).toLowerCase();
    return (
      text.includes(fileStem) ||
      (fileStem.length >= 5 && text.includes(fileStem.split(".")[0] ?? ""))
    );
  });
}

/* Legacy deterministic fallback builders intentionally disabled.
function shouldAvoidClarifyingFallback(ctx: AdviceContext): boolean {
  return (
    hasRepeatedFileClarifyingContext(ctx) ||
    cadencePressureFromRepeat(ctx) ||
    hasSubstantiveClipboardFacts(ctx.facts)
  );
}
*/

function hasSubstantiveClipboardFacts(facts: ProactiveSignalFact[]): boolean {
  return facts.some(
    (fact) =>
      fact.kind === "clipboard" &&
      /error|exception|failed|cannot|denied|not found|traceback|panic|function|const|class|import|def |https?:\/\/|www\.|ошиб/i.test(
        fact.detail,
      ),
  );
}

/*

function buildConcreteStepCandidate(
  ctx: AdviceContext,
  facts: ProactiveSignalFact[],
  reason: string,
): AdviceCandidate | null {
  const file = facts.find((fact) => fact.kind === "file");
  const clip = facts.find((fact) => fact.kind === "clipboard");
  const screen = facts.find((fact) => fact.kind === "screen");
  const urgency = facts.find((fact) => fact.kind === "urgency");
  const anchor = clip?.detail ?? file?.detail ?? ctx.preliminaryAnchor;
  if (!anchor) {
    return null;
  }
  const evidenceIds = [clip?.id, file?.id, screen?.id, urgency?.id].filter(
    Boolean,
  ) as string[];
  return {
    id: "file-concrete-step-after-clarifying",
    kind: "debug_next_step",
    evidenceIds,
    actionText: clip
      ? `По буферу «${anchor.slice(0, 180)}»: выдели ключевую ошибку/символ, свяжи с ближайшим файлом или последним изменением и проверь одну конкретную гипотезу.`
      : `По ${anchor}: выбери ближайший измененный блок, проверь его входные данные и один видимый выход, затем запусти самый короткий сценарий, который подтвердит именно этот блок.`,
    expectedUtility: 0.68,
    interruptionCost: 0.24,
    confidence: clip ? 0.72 : file ? 0.62 : 0.54,
    reason,
    score: 0.72,
  };
}

function buildNonClarifyingAdviceFallback(input: {
  ctx: AdviceContext;
  adviceFacts: ProactiveSignalFact[];
  advicePlan: ReturnType<typeof planAdvice> | null;
  candidateTopics: string[];
  ragSnippets: string[];
  reason: string;
}): ProactiveLlmBundle | null {
  const selected = input.advicePlan?.selected;
  const candidate = !isClarifyingCandidate(selected)
    ? selected
    : buildConcreteStepCandidate(input.ctx, input.adviceFacts, input.reason);
  const fallback = buildAdviceFallbackBundle(
    synthesisInput(input.ctx, input.candidateTopics, candidate, input.ragSnippets),
    input.adviceFacts,
    input.reason,
  );
  if (!fallback || isClarifyingCandidate(fallback.selectedAdviceCandidate)) {
    return null;
  }
  return {
    ...fallback,
    initiativeMove: fallback.initiativeMove ?? "concrete_step",
    selectedAdviceCandidate: candidate ?? fallback.selectedAdviceCandidate,
  };
}
*/

export function decideAdviceStrategy(ctx: AdviceContext): {
  strategy: AdviceStrategy;
  trace: AdviceTraceStep[];
  rotatedTopics?: string[];
} {
  const trace: AdviceTraceStep[] = [];

  if (!ctx.advisorEnabled) {
    pushTrace(trace, "safety", "советник выкл");
    return { strategy: "SILENT", trace };
  }
  if (ctx.safety.loading) {
    pushTrace(trace, "safety", "loading");
    return { strategy: "SILENT", trace };
  }
  if (!ctx.safety.idleGateOpen) {
    pushTrace(trace, "safety", "idle gate closed");
    return { strategy: "SILENT", trace };
  }

  if (!ctx.hasActionableSignals) {
    pushTrace(trace, "signals", "нет actionable сигналов — defer smalltalk");
    return { strategy: "DEFER_SMALLTALK", trace };
  }

  pushTrace(
    trace,
    "urgency",
    `${ctx.urgency.level} · score ${ctx.urgency.score} · ${ctx.urgency.reasons.join(" · ") || "—"}`,
  );

  if (ctx.cadencePressure.reasons.length > 0) {
    pushTrace(
      trace,
      "cadence",
      `pressure ${ctx.cadencePressure.level}: ${ctx.cadencePressure.reasons.join(" · ")}`,
    );
  }

  const thinContext = isThinAdviceContext(ctx.facts);
  const fileOnlyContext =
    !ctx.facts.some((fact) =>
      ["clipboard", "code", "query", "task", "reference", "hypothesis"].includes(
        fact.kind,
      ),
    ) && ctx.facts.some((fact) => fact.kind === "file");
  const fileFact = ctx.facts.find((fact) => fact.kind === "file");
  const repeatCadence = cadencePressureFromRepeat(ctx);
  const substantiveClipboard = hasSubstantiveClipboardFacts(ctx.facts);

  if (
    (thinContext || fileOnlyContext) &&
    hasRecentClarifyingOnFile(fileFact?.detail, ctx.now)
  ) {
    pushTrace(
      trace,
      "context",
      "clarifying по файлу уже был — defer smalltalk",
    );
    return { strategy: "DEFER_SMALLTALK", trace };
  }

  if (
    (thinContext || fileOnlyContext) &&
    !substantiveClipboard &&
    (!ctx.llmOnline ||
      repeatCadence ||
      ctx.cadencePressure.level === "medium" ||
      ctx.cadencePressure.level === "high")
  ) {
    pushTrace(
      trace,
      "signals",
      !ctx.llmOnline
        ? "тонкий контекст без LLM — defer smalltalk"
        : "тонкий контекст + cadence — defer smalltalk",
    );
    return { strategy: "DEFER_SMALLTALK", trace };
  }

  if (
    ctx.cadencePressure.level === "high" ||
    ctx.cadencePressure.level === "medium"
  ) {
    const rotatedTopics = rotateConversationTopics(ctx);
    pushTrace(trace, "rotate", `ротация тем: ${rotatedTopics.slice(0, 2).join(" | ") || "fallback"}`);
    return { strategy: "ROTATE_TOPIC", trace, rotatedTopics };
  }

  pushTrace(trace, "strategy", "fresh advice");
  return { strategy: "FRESH_ADVICE", trace };
}

function synthesisInput(
  ctx: AdviceContext,
  candidateTopics: string[],
  adviceCandidate?: ReturnType<typeof planAdvice>["selected"],
  ragSnippets?: string[],
  codeExcerpts?: Array<{ file: string; text: string }>,
) {
  const mergedCodeExcerpts = [
    ...(codeExcerpts ?? []),
    ...(ctx.packageOptions.proactiveIdeExcerpts ?? []),
  ].slice(0, 6);
  return {
    bundle: ctx.bundle,
    tone: "advice" as const,
    // Recent topics guide rotation, but must not veto a new concrete observation.
    bannedTopics: [],
    candidateTopics,
    sessionMinutes: ctx.packageOptions.sessionMinutes,
    windowMinutes: ctx.packageOptions.windowMinutes,
    companionSilenceMs: ctx.packageOptions.companionSilenceMs,
    recentUserMessage: ctx.packageOptions.recentUserMessage,
    urgency: ctx.urgency,
    recentChatTurns: ctx.packageOptions.recentChatTurns,
    llmOnline: ctx.llmOnline,
    ragSnippets: ragSnippets?.length ? ragSnippets : undefined,
    codeExcerpts: mergedCodeExcerpts.length ? mergedCodeExcerpts : undefined,
    adviceCandidate,
    requirePracticalHook: true,
  };
}

function ensureDeliverableBundle(
  _ctx: AdviceContext,
  llmBundle: ProactiveLlmBundle,
  _adviceFacts: ProactiveSignalFact[],
  _advicePlan: ReturnType<typeof planAdvice> | null,
  _candidateTopics: string[],
  _ragSnippets: string[],
  _trace: AdviceTraceStep[],
): ProactiveLlmBundle {
  // The user explicitly prefers a missed attempt over deterministic replacement text.
  return llmBundle;
  /*
  let bundle = llmBundle;
  const avoidClarifying = shouldAvoidClarifyingFallback(ctx);

  if (
    bundle.shouldSend &&
    isThinAdviceContext(adviceFacts) &&
    (isThinContextGenericAdvice(bundle.practicalHook ?? "", adviceFacts, bundle) ||
      isGenericAdviceText(bundle.practicalHook ?? ""))
  ) {
    const replacement = avoidClarifying
      ? buildNonClarifyingAdviceFallback({
          ctx,
          adviceFacts,
          advicePlan,
          candidateTopics,
          ragSnippets,
          reason: "thin context generic synthesis after clarifying",
        })
      : buildClarifyingProbeBundle(
          synthesisInput(ctx, candidateTopics, advicePlan?.selected, ragSnippets),
          adviceFacts,
          "thin context generic synthesis",
        );
    if (replacement) {
      pushTrace(
        trace,
        "quality",
        avoidClarifying
          ? "downgrade thin generic -> concrete step"
          : "downgrade thin generic -> clarifying",
      );
      bundle = replacement;
      setLastProactiveLlmBundle(replacement, adviceFacts);
    }
  }

  if (bundle.shouldSend) {
    const hookText = [bundle.practicalHook, ...(bundle.adviceSteps ?? [])]
      .filter(Boolean)
      .join(" ");
    const adviceTopicKey = buildAdviceTopicKey({
      anchor: ctx.preliminaryAnchor,
      processName: ctx.packageOptions.processName,
      windowTitle: ctx.packageOptions.windowTitle,
      signalSummary: ctx.urgency.reasons.join("; "),
    });
    const duplicateIssues = evaluateAdviceNovelty({
      text: hookText,
      candidateKind:
        bundle.selectedAdviceCandidate?.kind ?? bundle.initiativeMove,
      recentEntries: loadAdviceLedger().filter(
        (entry) => entry.topicKey === adviceTopicKey,
      ),
    });
    const isNearDuplicate = duplicateIssues.some(
      (issue) =>
        issue.kind === "repeat_text" || issue.kind === "repeat_archetype",
    );
    if (isNearDuplicate) {
      const rotated = avoidClarifying
        ? buildNonClarifyingAdviceFallback({
            ctx,
            adviceFacts,
            advicePlan,
            candidateTopics,
            ragSnippets,
            reason: "duplicate advice rotated after clarifying",
          })
        : buildClarifyingProbeBundle(
            synthesisInput(ctx, candidateTopics, advicePlan?.selected, ragSnippets),
            adviceFacts,
            "duplicate advice rotated",
          );
      if (rotated) {
        pushTrace(
          trace,
          "quality",
          avoidClarifying
            ? "duplicate -> concrete step rotation"
            : "duplicate -> clarifying rotation",
        );
        bundle = rotated;
        setLastProactiveLlmBundle(rotated, adviceFacts);
      }
    }
  }

  if (!bundle.shouldSend) {
    const fallback = avoidClarifying
      ? buildNonClarifyingAdviceFallback({
          ctx,
          adviceFacts,
          advicePlan,
          candidateTopics,
          ragSnippets,
          reason: bundle.rejectReason ?? "llm synthesis rejected",
        })
      : tryAdviceFallbackChain(
          synthesisInput(ctx, candidateTopics, advicePlan?.selected, ragSnippets),
          adviceFacts,
          bundle.rejectReason ?? "llm synthesis rejected",
        );
    if (fallback) {
      pushTrace(trace, "fallback", fallback.rejectReason ?? "advice fallback");
      bundle = fallback;
      setLastProactiveLlmBundle(fallback, adviceFacts);
    }
  }

  if (!bundle.shouldSend) {
    const clarifying = avoidClarifying
      ? buildNonClarifyingAdviceFallback({
          ctx,
          adviceFacts,
          advicePlan,
          candidateTopics,
          ragSnippets,
          reason: bundle.rejectReason ?? "engine concrete-step guarantee",
        })
      : buildClarifyingProbeBundle(
          synthesisInput(ctx, candidateTopics, advicePlan?.selected, ragSnippets),
          adviceFacts,
          bundle.rejectReason ?? "engine clarifying guarantee",
        );
    if (clarifying) {
      pushTrace(
        trace,
        "guarantee",
        avoidClarifying
          ? "concrete step guarantee"
          : "clarifying probe guarantee",
      );
      bundle = clarifying;
      setLastProactiveLlmBundle(clarifying, adviceFacts);
    }
  }

  return bundle;
  */
}

async function buildAdvicePackage(
  ctx: AdviceContext,
  strategy: AdviceStrategy,
  rotatedTopics: string[] | undefined,
  trace: AdviceTraceStep[],
): Promise<{ package: ProactiveInitiativePackage | null; bundle: ProactiveLlmBundle | null }> {
  const candidateTopics =
    strategy === "ROTATE_TOPIC" && rotatedTopics?.length
      ? rotatedTopics
      : ctx.candidateTopics;
  const preliminaryAnchor =
    pickPlannedInitiativeAnchor(candidateTopics, {
      recentProactive: ctx.banned,
      windowTitle: ctx.packageOptions.windowTitle,
      dominantFile: ctx.bundle.editorFile,
    }) ?? candidateTopics[0] ?? ctx.preliminaryAnchor;

  let ragSnippets: string[] = [];
  if (
    ctx.settings.ragEnabled &&
    (strategy === "FRESH_ADVICE" || strategy === "ROTATE_TOPIC") &&
    (hasProactiveDebugSignals(ctx.bundle) ||
      ctx.bundle.clipboardSnippets.length > 0 ||
      ctx.bundle.advisor.activitySummary.inputFrictionScore >= 1)
  ) {
    try {
      const ragQuery = buildProactiveWebSearchQuery(ctx.bundle, preliminaryAnchor);
      const ragHits = await searchRag(ragQuery, ctx.settings);
      ragSnippets = ragHits.matches
        .slice(0, 3)
        .map((hit) => hit.text.trim().slice(0, 420))
        .filter(Boolean);
      if (ragSnippets.length > 0) {
        pushTrace(trace, "rag", `${ragSnippets.length} snippet(s)`);
      }
    } catch {
      ragSnippets = [];
    }
  }

  const codeExcerpt = await loadCurrentCodeExcerpt(ctx.settings, ctx.bundle);
  const codeExcerpts = codeExcerpt
    ? [{ file: codeExcerpt.file, text: codeExcerpt.text }]
    : undefined;
  if (codeExcerpt) {
    pushTrace(trace, "code", `project excerpt: ${codeExcerpt.relativePath}`);
  }
  if (ctx.packageOptions.proactiveIdeExcerpts?.length) {
    pushTrace(
      trace,
      "ide",
      `snapshot evidence: ${ctx.packageOptions.proactiveIdeExcerpts.length}`,
    );
  }

  const adviceFacts = collectProactiveSignalFacts({
    ...synthesisInput(ctx, candidateTopics, undefined, ragSnippets, codeExcerpts),
    bundle: ctx.bundle,
    tone: "advice",
  });

  const adviceTopicKey = buildAdviceTopicKey({
    anchor: preliminaryAnchor,
    processName: ctx.packageOptions.processName,
    windowTitle: ctx.packageOptions.windowTitle,
    signalSummary: ctx.urgency.reasons.join("; "),
  });

  reconcilePendingAdviceOutcomes({
    afterState: buildAdviceObservedState({
      topicKey: adviceTopicKey,
      bundle: ctx.bundle,
      facts: adviceFacts,
      processName: ctx.packageOptions.processName,
      windowTitle: ctx.packageOptions.windowTitle,
    }),
  });

  const advicePlan = planAdvice({
    bundle: ctx.bundle,
    facts: adviceFacts,
    urgency: ctx.urgency,
    feedback: getRecentAdviceFeedback(adviceTopicKey),
    history: loadAdviceLedger(),
    outcomes: getRecentAdviceOutcomes(adviceTopicKey),
    candidateTopics,
    ragSnippets,
  });

  if (strategy === "CLARIFY") {
    pushTrace(trace, "build", "clarifying fallback disabled");
    return { package: null, bundle: null };
  }

  let llmBundle: ProactiveLlmBundle;
  if (ctx.llmOnline) {
    llmBundle = await synthesizeProactiveBundle(
      ctx.settings,
      synthesisInput(
        ctx,
        candidateTopics,
        advicePlan.selected,
        ragSnippets,
        codeExcerpts,
      ),
    );
    pushTrace(
      trace,
      "synthesis",
      `score ${llmBundle.usefulnessScore.toFixed(2)} · shouldSend ${llmBundle.shouldSend ? "да" : "нет"}`,
    );
  } else {
    pushTrace(trace, "synthesis", "llm offline — no fallback");
    return { package: null, bundle: null };
  }

  llmBundle = ensureDeliverableBundle(
    ctx,
    llmBundle,
    adviceFacts,
    advicePlan,
    candidateTopics,
    ragSnippets,
    trace,
  );

  if (!llmBundle.shouldSend) {
    pushTrace(trace, "build", "bundle still not deliverable");
    return { package: null, bundle: llmBundle };
  }

  const pkg = buildProactiveInitiativePackage(ctx.settings, ctx.plan.kind, {
    ...ctx.packageOptions,
    advisorAngle: ctx.plan.angle,
    conversationTopics:
      llmBundle.linkedThemes.length > 0
        ? llmBundle.linkedThemes
        : candidateTopics,
    urgency: ctx.urgency,
    llmBundle,
    proactiveCodeExcerpt: codeExcerpt
      ? { file: codeExcerpt.file, text: codeExcerpt.text }
      : undefined,
  });

  if (pkg.llmBundle) {
    pushTrace(
      trace,
      "package",
      buildGateContextFromBundle(pkg.llmBundle).slice(0, 120),
    );
  }

  return { package: pkg, bundle: llmBundle };
}

function isDuplicateClarifyingDelivery(
  hookText: string,
  topicKey: string,
  now = Date.now(),
): boolean {
  const recentClarifying = recentClarifyingEntries(now);
  const issues = evaluateAdviceNovelty({
    text: hookText,
    candidateKind: "clarifying_probe",
    recentEntries: [
      ...recentClarifying,
      ...loadAdviceLedger(now).filter((entry) => entry.topicKey === topicKey),
    ],
    now,
  });
  return issues.some(
    (issue) => issue.kind === "repeat_text" || issue.kind === "repeat_archetype",
  );
}

export async function runAdviceCycle(input: {
  settings: AppSettings;
  bundle: InitiativeSignalBundle;
  urgency: AdviceUrgency;
  packageOptions: ProactivePackageOptions;
  llmOnline: boolean;
  advisorEnabled: boolean;
  sinceAdviceAttemptMs: number;
  adviceIntervalMs: number;
  now?: number;
  safety: { idleGateOpen: boolean; loading: boolean };
}): Promise<AdviceDecision> {
  const trace: AdviceTraceStep[] = [];

  try {
    const ctx = gatherAdviceContext(input);
    const { strategy, trace: decideTrace, rotatedTopics } =
      decideAdviceStrategy(ctx);
    trace.push(...decideTrace);

    if (strategy === "SILENT") {
      const decision: AdviceDecision = {
        strategy,
        deliver: false,
        trace,
        package: null,
        bundle: null,
        reason: decideTrace[decideTrace.length - 1]?.detail ?? "silent",
        engineApproved: false,
      };
      persistAdviceTrace(decision);
      return decision;
    }

    if (strategy === "DEFER_SMALLTALK") {
      const decision: AdviceDecision = {
        strategy,
        deliver: false,
        trace,
        package: null,
        bundle: null,
        reason: "defer to smalltalk",
        engineApproved: false,
      };
      persistAdviceTrace(decision);
      return decision;
    }

    let built = await buildAdvicePackage(ctx, strategy, rotatedTopics, trace);
    let deliver = Boolean(built.package && built.bundle?.shouldSend);
    let finalStrategy: AdviceStrategy = strategy;
    if (deliver && built.bundle?.practicalHook) {
      const topicKey = buildAdviceTopicKey({
        anchor: ctx.preliminaryAnchor,
        processName: ctx.packageOptions.processName,
        windowTitle: ctx.packageOptions.windowTitle,
        signalSummary: ctx.urgency.reasons.join("; "),
      });
      if (
        (strategy === "CLARIFY" ||
          built.bundle.selectedAdviceCandidate?.kind === "clarifying_probe") &&
        isDuplicateClarifyingDelivery(built.bundle.practicalHook, topicKey)
      ) {
        pushTrace(trace, "novelty", "повтор clarifying — silent");
        deliver = false;
        finalStrategy = "SILENT";
      }
    }
    const decision: AdviceDecision = {
      strategy: finalStrategy,
      deliver,
      trace,
      package: deliver ? built.package : null,
      bundle: built.bundle,
      reason: deliver
        ? `${strategy} -> deliver`
        : finalStrategy === "SILENT"
          ? "duplicate clarifying — silent"
          : `${strategy} -> build failed`,
      engineApproved: deliver,
    };
    persistAdviceTrace(decision);
    return decision;
  } catch (error) {
    pushTrace(
      trace,
      "error",
      error instanceof Error ? error.message : "unknown engine error",
    );
    const decision: AdviceDecision = {
      strategy: "SILENT",
      deliver: false,
      trace,
      package: null,
      bundle: null,
      reason: "engine exception",
      engineApproved: false,
    };
    persistAdviceTrace(decision);
    return decision;
  }
}

/** Distinguishes transport/schema failures from legitimate policy silence. */
export function isAdviceGenerationFailure(decision: AdviceDecision): boolean {
  if (decision.deliver || decision.strategy === "DEFER_SMALLTALK") {
    return false;
  }
  const evidence = [
    decision.reason,
    decision.bundle?.rejectReason,
    ...decision.trace.map((step) => `${step.stage}: ${step.detail}`),
  ]
    .filter(Boolean)
    .join(" ");
  return /engine exception|synthesis failed|invalid[- ]schema|all live synthesis attempts failed|timed? ?out|timeout|http \d{3}|network|oauth/i.test(
    evidence,
  );
}

export function hasSubstantiveAdviceSignals(
  bundle: InitiativeSignalBundle,
  urgency: AdviceUrgency,
): boolean {
  return (
    bundle.hasActionableSignals ||
    hasActionableAdvisorSignals(bundle.advisor) ||
    urgency.level !== "none"
  );
}

export function shouldAttemptAdviceCycle(input: {
  advisorEnabled: boolean;
  idleGateOpen: boolean;
  loading: boolean;
  urgency: AdviceUrgency;
  hasActionableSignals: boolean;
  adviceStarved?: boolean;
  sinceAdviceAttemptMs?: number;
  adviceIntervalMs?: number;
}): boolean {
  if (!input.advisorEnabled || !input.idleGateOpen || input.loading) {
    return false;
  }
  if (!input.hasActionableSignals && input.urgency.level === "none") {
    return false;
  }
  if (input.adviceStarved) {
    return true;
  }
  if (input.urgency.level === "high") {
    return true;
  }
  if (
    input.sinceAdviceAttemptMs !== undefined &&
    input.adviceIntervalMs !== undefined &&
    input.sinceAdviceAttemptMs < input.adviceIntervalMs
  ) {
    const hasFreshBypass = input.urgency.reasons.some((reason) =>
      /свеж(ий|ая) буфер|фрагмент кода|ошибка в буфере|недавнее действие|недавний вопрос|смена фокуса|актуальный поиск/i.test(
        reason,
      ),
    );
    if (!hasFreshBypass) {
      return false;
    }
  }
  return input.urgency.level !== "none" || input.hasActionableSignals;
}

export function describeAdviceEngineForDiagnostics(): {
  strategy: string;
  deliver: boolean;
  reason: string;
  trace: string[];
  bundleScore: number | null;
  moveReputation: string[];
} {
  const last = getLastAdviceDecisionTrace();
  if (!last) {
    return {
      strategy: "—",
      deliver: false,
      reason: "ещё не было цикла",
      trace: [],
      bundleScore: null,
      moveReputation: [],
    };
  }
  return {
    strategy: last.strategy,
    deliver: last.deliver,
    reason: last.reason,
    trace: last.trace.map((step) => `${step.stage}: ${step.detail}`),
    bundleScore: last.bundle?.usefulnessScore ?? null,
    moveReputation: [],
  };
}
