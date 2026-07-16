export type ChatRole = "system" | "user" | "assistant";

export type FocusRecapMeta = {
  done: string;
  stuck: string;
  nextStep: string;
  sessionId: string;
};

export type ChatSource = {
  title: string;
  publisher: string;
  url: string;
  publishedAt: number;
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
  proactive?: boolean;
  adviceId?: string;
  adviceFeedback?: import("../character/adviceLedger").AdviceFeedback;
  focusRecap?: FocusRecapMeta;
  reaction?: string;
  sources?: ChatSource[];
};
