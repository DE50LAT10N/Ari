import type { CharacterEmotion, CharacterState } from "../types/character";
import type { PresenceScene } from "./presence";
import type { SilentReactionKind } from "./silentReactions";
import type { LifecycleState } from "./lifecycle";
import {
  resolveEmotionSpriteFallbackPath,
  resolveEmotionSpritePath,
  stateSpritePaths,
} from "./emotionAssets";

export type CharacterReaction = {
  kind: SilentReactionKind;
  emotion?: CharacterEmotion;
};

export type SpriteSet = "default" | "night" | "focus" | "cozy";

export const AVATAR_REACTION_EVENT = "ari-avatar-reaction";

export interface CharacterRenderer {
  setEmotion(emotion: CharacterEmotion): void;
  setState(state: CharacterState): void;
  playReaction(reaction: CharacterReaction): void;
  setScene(scene: PresenceScene): void;
  setLifecycle(lifecycle: LifecycleState): void;
  setSpriteSet(set: SpriteSet): void;
  getSpriteSet(): SpriteSet;
  getAvatarPath(
    emotion?: CharacterEmotion,
    state?: CharacterState,
    speaking?: boolean,
  ): string;
  dispose(): void;
}

export class PngCharacterRenderer implements CharacterRenderer {
  private emotion: CharacterEmotion = "neutral";
  private state: CharacterState = "idle";
  private scene: PresenceScene = "break";
  private lifecycle: LifecycleState = "awake";
  private spriteSet: SpriteSet = "default";

  setEmotion(emotion: CharacterEmotion): void {
    this.emotion = emotion;
  }

  setState(state: CharacterState): void {
    this.state = state;
  }

  playReaction(reaction: CharacterReaction): void {
    window.dispatchEvent(
      new CustomEvent(AVATAR_REACTION_EVENT, { detail: reaction }),
    );
  }

  setScene(scene: PresenceScene): void {
    this.scene = scene;
    if (scene === "night") {
      this.spriteSet = "night";
    } else if (scene === "focus") {
      this.spriteSet = "focus";
    } else if (scene === "morning" || scene === "evening") {
      this.spriteSet = "cozy";
    } else if (
      this.spriteSet === "night" ||
      this.spriteSet === "focus" ||
      this.spriteSet === "cozy"
    ) {
      this.spriteSet = "default";
    }
  }

  setLifecycle(lifecycle: LifecycleState): void {
    this.lifecycle = lifecycle;
  }

  setSpriteSet(set: SpriteSet): void {
    this.spriteSet = set;
  }

  getSpriteSet(): SpriteSet {
    return this.spriteSet;
  }

  getAvatarPath(
    emotion?: CharacterEmotion,
    state?: CharacterState,
    speaking = false,
  ): string {
    const e = emotion ?? this.emotion;
    const s = state ?? this.state;

    if (speaking && (s === "speaking" || s === "thinking")) {
      return stateSpritePaths.speaking;
    }

    if (e === "neutral" && (s === "idle" || s === "thinking" || s === "speaking")) {
      return stateSpritePaths.idle;
    }

    return resolveEmotionSpritePath(e);
  }

  getLegacyFallbackPath(emotion?: CharacterEmotion, state?: CharacterState): string {
    const e = emotion ?? this.emotion;
    const s = state ?? this.state;
    if (s === "speaking") {
      return resolveEmotionSpritePath(e);
    }
    if (e === "neutral" && (s === "idle" || s === "thinking")) {
      return stateSpritePaths.idle;
    }
    return resolveEmotionSpriteFallbackPath(e);
  }

  getScene(): PresenceScene {
    return this.scene;
  }

  getLifecycle(): LifecycleState {
    return this.lifecycle;
  }

  dispose(): void {
    // No-op for PNG renderer.
  }
}
