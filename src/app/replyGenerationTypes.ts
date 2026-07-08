import type { AdvisorAngle } from "../character/advisorEngine";
import type { InitiativeKind } from "../character/initiativeKinds";
import type { ProactiveReplyTone } from "../character/proactiveTone";

export type ReplyGenerationOptions = {
  proactive?: boolean;
  eventDescription?: string;
  initiativeAnchor?: string;
  softInitiativeAnchor?: boolean;
  bannedProactiveTopics?: string[];
  screenObservation?: {
    title: string;
    processName: string;
    text: string;
  };
  initiativeKind?: InitiativeKind;
  proactiveReplyTone?: ProactiveReplyTone;
  advisorAngle?: AdvisorAngle;
  proactiveSignalSummary?: string;
  proactiveLinkNarrative?: string;
  proactivePracticalHook?: string;
  proactiveAdviceSteps?: string[];
  proactiveCodeExcerpt?: { file: string; text: string };
  proactiveInitiativeMove?: string;
  proactiveAdviceCandidateKind?: string;
  proactiveNoveltyGuidance?: string;
};
