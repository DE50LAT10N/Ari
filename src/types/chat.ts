export type ChatRole = "system" | "user" | "assistant";

export type FocusRecapMeta = {
  done: string;
  stuck: string;
  nextStep: string;
  sessionId: string;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  emotion?: import("./character").CharacterEmotion;
  action?: import("../tools/safeActions").SafeActionProposal;
  branchId?: string;
  parentMessageId?: string;
  isCanon?: boolean;
  messageId?: string;
  adviceId?: string;
  adviceFeedback?: import("../character/adviceLedger").AdviceFeedback;
  focusRecap?: FocusRecapMeta;
  reaction?: string;
};
