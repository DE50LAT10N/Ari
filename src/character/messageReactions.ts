export const MESSAGE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎"] as const;

export type MessageReaction = (typeof MESSAGE_REACTIONS)[number];

export function isValidMessageReaction(
  value: unknown,
): value is MessageReaction {
  return (
    typeof value === "string" &&
    (MESSAGE_REACTIONS as readonly string[]).includes(value)
  );
}

export type ReactionSentiment = "positive" | "negative" | "surprise" | "sad";

export function reactionSentiment(emoji: MessageReaction): ReactionSentiment {
  switch (emoji) {
    case "👍":
    case "❤️":
    case "😂":
      return "positive";
    case "😮":
      return "surprise";
    case "😢":
      return "sad";
    case "👎":
      return "negative";
    default:
      return "positive";
  }
}

const POSITIVE_ACKS = ["Приятно.", "Заметила.", "Хорошо."];
const NEGATIVE_ACKS = ["Поняла.", "Учту.", "Ладно."];
const SURPRISE_ACKS = ["Ого.", "Неожиданно.", "Хм."];
const SAD_ACKS = ["Эх.", "Понимаю.", "Бывает."];

export function pickReactionAcknowledgment(emoji: MessageReaction): string {
  const pool = {
    positive: POSITIVE_ACKS,
    negative: NEGATIVE_ACKS,
    surprise: SURPRISE_ACKS,
    sad: SAD_ACKS,
  }[reactionSentiment(emoji)];
  return pool[Math.floor(Math.random() * pool.length)] ?? "Заметила.";
}

export function reactionAckEmotion(emoji: MessageReaction) {
  switch (reactionSentiment(emoji)) {
    case "positive":
      return "happy" as const;
    case "negative":
      return "annoyed" as const;
    case "surprise":
      return "surprised" as const;
    case "sad":
      return "empathetic" as const;
    default:
      return "neutral" as const;
  }
}
