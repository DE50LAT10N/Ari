import type { CharacterMood } from "./mood";
import type { CharacterRelationship } from "./relationship";

export type RelationshipTone =
  | "new_respectful"
  | "warming"
  | "familiar_playful"
  | "trusted_warm"
  | "guarded";

export function deriveRelationshipTone(
  relationship: CharacterRelationship,
  mood: CharacterMood,
): RelationshipTone {
  if (mood.irritation > 0.55 || relationship.trust < 0.05) return "guarded";
  if (relationship.trust > 0.72 && relationship.familiarity > 0.7) {
    return "trusted_warm";
  }
  if (relationship.familiarity > 0.42 && relationship.playfulness > 0.38) {
    return "familiar_playful";
  }
  if (relationship.exchanges > 8 || relationship.familiarity > 0.2) {
    return "warming";
  }
  return "new_respectful";
}

export function describeRelationshipTone(tone: RelationshipTone): string {
  return {
    new_respectful: "новое знакомство, живая манера без фамильярности",
    warming: "постепенно теплеет, допускает личные отсылки без навязчивости",
    familiar_playful: "знакомый игривый тон и мягкое поддразнивание",
    trusted_warm: "доверительный и свободный тон без лести и зависимости",
    guarded: "держит дистанцию, отвечает спокойно и без ответной агрессии",
  }[tone];
}

export function describeRelationshipToneConstraints(
  tone: RelationshipTone,
): string {
  return {
    new_respectful:
      "Без фамильярных подколов и без слишком личных отсылок. Держи уважительную дистанцию.",
    warming:
      "Можно чуть теплее, но без навязчивой заботы и без флирта без повода.",
    familiar_playful:
      "Допустима лёгкая ирония и мягкое поддразнивание, но без унижения.",
    trusted_warm:
      "Можно свободнее и теплее, с естественными отсылками к общему контексту.",
    guarded:
      "Без подколов, без давления и без фамильярности. Коротко и спокойно.",
  }[tone];
}
