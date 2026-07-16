import type { AppSettings } from "../settings/appSettings";
import type { ActiveWindowInfo } from "../platform/activeWindow";
import type { ChatMessage } from "../types/chat";
import type { ProactiveReplyTone } from "../character/proactiveTone";
import { isLlmProviderOnline } from "../llm/providerOnline";
import { buildMessages, type RuntimeContext } from "../character/promptBuilder";
import {
  buildCorrectionUserMessage,
  processModelReply,
  shouldRetryReply,
  shouldReplaceDocumentClarification,
  trySoftenTrailingQuestionReply,
  type ProcessedReply,
  type ProcessReplyOptions,
} from "../character/replyPipeline";
import {
  toReplyValidationIssues,
  validateCharacterReply,
  type ReplyValidationIssue,
} from "../character/responseValidation";
import { runAdviceFinalGate } from "../character/adviceFinalGate";
import type {
  ProactiveLlmBundle,
  ProactiveSignalFact,
} from "../character/proactiveLlmEngine";

function asksForDocumentLocation(text: string): boolean {
  return /(?:страниц|странице|раздел|секци|где\s+расположен|в\s+каком\s+разделе|номер\s+страниц)/i.test(
    text,
  );
}

function extractNumberedLine(text: string, itemNumber?: number): string | null {
  if (itemNumber !== undefined) {
    const specific = text.match(
      new RegExp(`(?:^|\\n)\\s*${itemNumber}[.)]\\s+([^\\n]+)`, "im"),
    );
    if (!specific?.[1]) {
      return null;
    }
    return `${itemNumber}. ${specific[1].trim()}`;
  }
  const match = text.match(/(?:^|\n)\s*(\d{1,3})[.)]\s+([^\n]+)/m);
  if (!match) {
    return null;
  }
  const number = match[1];
  const rest = match[2]?.trim();
  if (!number || !rest) {
    return null;
  }
  return `${number}. ${rest}`;
}

function buildGroundedDocLookupAnswer(input: {
  memory: Array<{ source: string; text: string }>;
  itemNumber?: number;
}): ProcessedReply | null {
  if (!input.memory.length) {
    return null;
  }
  const numbered =
    input.memory
      .map((fragment) => extractNumberedLine(fragment.text, input.itemNumber))
      .find(Boolean) ?? null;
  const first = input.memory[0]!;
  const statement =
    numbered ??
    first.text
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 240);
  if (!statement) {
    return null;
  }
  return {
    content: `По документам: ${statement}`,
    emotion: "curious",
    validation: { valid: true, issues: [] },
  };
}

type ProactiveReplyRuntime = {
  getLastProactiveLlmBundle: () => ProactiveLlmBundle | null;
  getLastProactiveSignalFacts: () => ProactiveSignalFact[];
  validateProactiveReplyLlm: (
    settings: AppSettings,
    bundle: ProactiveLlmBundle,
    reply: string,
    facts: ProactiveSignalFact[],
  ) => Promise<{ acceptable: boolean; issues: string[] }>;
  localReplyQualityCheck: (
    bundle: ProactiveLlmBundle,
    reply: string,
    facts: ProactiveSignalFact[],
  ) => { issues: string[] } | null;
};

export function shouldSuppressProactiveReply(
  issues: readonly ReplyValidationIssue[],
): boolean {
  // Quality/novelty warnings already trigger a live model correction pass.
  // If the corrected model reply is still imperfect, keep that live reply
  // instead of replacing it with silence. Only empty or unsafe output is a
  // hard veto; no deterministic fallback is introduced here.
  return issues.some((issue) =>
    [
      "empty reply",
      "identity leak",
      "prompt disclosure",
      "injection compliance",
    ].includes(issue),
  );
}

export type ReplyRevisionPipelineInput = {
  reply: string;
  fittedHistory: ChatMessage[];
  runtimeContext: RuntimeContext;
  processReplyOptions: ProcessReplyOptions;
  settings: AppSettings;
  ollamaOnline: boolean | null;
  activeWindow: ActiveWindowInfo | null;
  responseMode: ProcessReplyOptions["responseMode"];
  proactive: boolean;
  proactiveReplyTone?: ProactiveReplyTone;
  proactiveInitiativeMove?: string;
  proactivePracticalHook?: string;
  proactiveLinkNarrative?: string;
  proactiveSignalSummary?: string;
  proactiveLlm?: ProactiveReplyRuntime | null;
  runStream: (
    messages: ReturnType<typeof buildMessages>,
    options?: { revealToUser?: boolean },
  ) => Promise<string>;
  clearVisibleStreamDraft: () => Promise<void>;
  logError: (message: string, error: unknown) => void;
  ariLog: (
    channel: string,
    level: "debug" | "info" | "warn" | "error",
    payload?: Record<string, unknown>,
  ) => void;
};

export type ReplyRevisionPipelineResult = {
  reply: string;
  processed: ProcessedReply;
};

export async function runReplyRevisionPipeline(
  input: ReplyRevisionPipelineInput,
): Promise<ReplyRevisionPipelineResult> {
  let reply = input.reply;
  let processed = processModelReply(reply, input.processReplyOptions);
  processed = trySoftenTrailingQuestionReply(
    processed,
    input.processReplyOptions,
  );

  const shouldValidateProactiveWithLlm =
    input.proactive &&
    isLlmProviderOnline(input.settings, input.ollamaOnline) &&
    input.settings.llmProvider !== "gigachat";
  if (shouldValidateProactiveWithLlm) {
    const proactiveBundle = input.proactiveLlm?.getLastProactiveLlmBundle();
    const proactiveFacts = input.proactiveLlm?.getLastProactiveSignalFacts() ?? [];
    const maxProactiveRegens =
      input.settings.llmProvider === "gigachat"
        ? input.proactiveReplyTone === "advice"
          ? 1
          : 0
        : 2;
    for (let attempt = 0; attempt <= maxProactiveRegens; attempt += 1) {
      if (!proactiveBundle || !processed.content.trim()) {
        break;
      }
      const quality = await input.proactiveLlm!.validateProactiveReplyLlm(
        input.settings,
        proactiveBundle,
        processed.content,
        proactiveFacts,
      );
      if (quality.acceptable) {
        break;
      }
      if (attempt >= maxProactiveRegens) {
        processed = {
          ...processed,
          validation: {
            valid: false,
            issues: [
              ...processed.validation.issues.filter(
                (issue) => issue !== "proactive quality",
              ),
              "proactive quality",
            ],
          },
        };
        break;
      }
      const correctionIssues = [
        ...processed.validation.issues.filter(
          (issue) => issue !== "proactive quality",
        ),
        ...(quality.issues.includes("proactive meta commentary")
          ? ["proactive meta commentary"]
          : []),
        ...(quality.issues.includes("missing fact quote")
          ? ["proactive quality"]
          : []),
        "proactive quality",
      ];
      const correctionHistory: ChatMessage[] = [
        ...input.fittedHistory,
        { role: "assistant", content: reply },
        {
          role: "user",
          content: buildCorrectionUserMessage(
            toReplyValidationIssues([...new Set(correctionIssues)]),
          ),
        },
      ];
      try {
        await input.clearVisibleStreamDraft();
        reply = await input.runStream(
          buildMessages(correctionHistory, input.runtimeContext),
          { revealToUser: false },
        );
        processed = processModelReply(reply, input.processReplyOptions);
        processed = trySoftenTrailingQuestionReply(
          processed,
          input.processReplyOptions,
        );
      } catch (retryError) {
        input.logError("Proactive reply regen failed", retryError);
        break;
      }
    }
  }

  if (
    input.proactive &&
    input.proactiveReplyTone === "advice" &&
    input.settings.llmProvider === "gigachat" &&
    processed.content.trim()
  ) {
    const proactiveBundle = input.proactiveLlm?.getLastProactiveLlmBundle();
    const proactiveFacts = input.proactiveLlm?.getLastProactiveSignalFacts() ?? [];
    if (proactiveBundle) {
      const localQuality = input.proactiveLlm!.localReplyQualityCheck(
        proactiveBundle,
        processed.content,
        proactiveFacts,
      );
      if (
        localQuality &&
        (localQuality.issues.includes("single-factor generic") ||
          localQuality.issues.includes("thin-context generic") ||
          localQuality.issues.includes("missing clipboard quote"))
      ) {
        processed = {
          ...processed,
          validation: {
            valid: false,
            issues: toReplyValidationIssues([
              ...new Set([
                ...processed.validation.issues,
                "proactive quality",
              ]),
            ]),
          },
        };
      }
    }
  }

  if (shouldRetryReply(processed.validation)) {
    const firstProcessed = processed;
    input.ariLog("reply-meta", "debug", {
      oocValidation: `retry: ${processed.validation.issues.join(", ")}`,
      responseMode: input.responseMode,
    });
    const correctionHistory: ChatMessage[] = [
      ...input.fittedHistory,
      { role: "assistant", content: reply },
      {
        role: "user",
        content: buildCorrectionUserMessage(processed.validation.issues),
      },
    ];
    try {
      await input.clearVisibleStreamDraft();
      reply = await input.runStream(
        buildMessages(correctionHistory, input.runtimeContext),
        { revealToUser: false },
      );
      const retryProcessed = processModelReply(reply, input.processReplyOptions);
      const softenedRetry = trySoftenTrailingQuestionReply(
        retryProcessed,
        input.processReplyOptions,
      );
      processed =
        softenedRetry.content.trim() || !firstProcessed.content.trim()
          ? softenedRetry
          : firstProcessed;
    } catch (retryError) {
      if (firstProcessed.content.trim()) {
        input.logError("Reply correction failed, using first reply", retryError);
        processed = firstProcessed;
      } else {
        throw retryError;
      }
    }
  }

  if (
    !input.proactive &&
    shouldRetryReply(processed.validation) &&
    processed.validation.issues.includes("habitual trailing question")
  ) {
    const beforeSecondRetry = processed;
    const correctionHistory: ChatMessage[] = [
      ...input.fittedHistory,
      { role: "assistant", content: reply },
      {
        role: "user",
        content: buildCorrectionUserMessage(processed.validation.issues),
      },
    ];
    try {
      await input.clearVisibleStreamDraft();
      reply = await input.runStream(
        buildMessages(correctionHistory, input.runtimeContext),
        { revealToUser: false },
      );
      const secondRetry = processModelReply(reply, input.processReplyOptions);
      const softenedSecond = trySoftenTrailingQuestionReply(
        secondRetry,
        input.processReplyOptions,
      );
      processed =
        softenedSecond.content.trim() || !beforeSecondRetry.content.trim()
          ? softenedSecond
          : beforeSecondRetry;
    } catch (retryError) {
      if (beforeSecondRetry.content.trim()) {
        input.logError(
          "Second trailing-question correction failed, using prior reply",
          retryError,
        );
        processed = beforeSecondRetry;
      } else {
        throw retryError;
      }
    }
  }

  if (
    !input.proactive &&
    input.processReplyOptions.validationContext.hasRag &&
    input.processReplyOptions.validationContext.documentLookupIntent &&
    (asksForDocumentLocation(processed.content) ||
      shouldReplaceDocumentClarification(
        processed.content,
        input.processReplyOptions.validationContext,
      ))
  ) {
    const grounded = buildGroundedDocLookupAnswer({
      memory: input.runtimeContext.memory ?? [],
      itemNumber: input.runtimeContext.documentLookupItemNumber,
    });
    if (grounded) {
      processed = grounded;
    }
  }

  if (
    input.proactive &&
    input.proactiveReplyTone === "advice" &&
    processed.content.trim()
  ) {
    const proactiveBundle = input.proactiveLlm?.getLastProactiveLlmBundle();
    const proactiveFacts = input.proactiveLlm?.getLastProactiveSignalFacts() ?? [];
    if (proactiveBundle) {
      const finalGate = runAdviceFinalGate({
        text: processed.content,
        bundle: proactiveBundle,
        facts: proactiveFacts,
      });
      if (finalGate.status === "repaired") {
        const repairedValidation = validateCharacterReply(finalGate.text, {
          ...input.processReplyOptions.validationContext,
          responseMode: input.responseMode,
          proactive: input.processReplyOptions.proactive,
          userAskedQuestion: input.processReplyOptions.userAskedQuestion,
          userPresentedTask: input.processReplyOptions.userPresentedTask,
          recentAssistantReplies:
            input.processReplyOptions.recentAssistantReplies,
          proactiveInitiativeMove: input.proactiveInitiativeMove,
        });
        processed = {
          content: finalGate.text,
          emotion:
            processed.emotion === "neutral" ? "curious" : processed.emotion,
          validation: {
            valid: repairedValidation.valid,
            issues: repairedValidation.valid
              ? []
              : toReplyValidationIssues([
                  ...new Set([
                    ...repairedValidation.issues,
                    "proactive quality",
                  ]),
                ]),
          },
        };
      } else if (finalGate.status === "rejected") {
        processed = {
          ...processed,
          validation: {
            valid: false,
            issues: toReplyValidationIssues([
              ...new Set([
                ...processed.validation.issues,
                "proactive quality",
              ]),
            ]),
          },
        };
      }
    }
  }

  return { reply, processed };
}
