import { describe, expect, it } from "vitest";
import { characterEmotions } from "../src/types/character";
import {
  allAlphaSpriteFiles,
  emotionSpriteFiles,
  emotionSpritePaths,
  stateSpriteFiles,
  stateSpritePaths,
} from "../src/character/emotionAssets";

describe("emotionAssets", () => {
  it("maps every character emotion to a unique alpha sprite file", () => {
    for (const emotion of characterEmotions) {
      expect(emotionSpriteFiles[emotion]).toMatch(/\.png$/i);
      expect(emotionSpritePaths[emotion]).toContain("/characters/ari/alpha/");
    }
    expect(Object.keys(emotionSpriteFiles)).toEqual([...characterEmotions]);
  });

  it("declares idle and speaking state sprites", () => {
    expect(stateSpriteFiles.idle).toBe("idle.png");
    expect(stateSpriteFiles.speaking).toBe("speaking.png");
    expect(stateSpritePaths.idle).toContain("idle.png");
    expect(stateSpritePaths.speaking).toContain("speaking.png");
  });

  it("lists each alpha png exactly once", () => {
    const expectedCount =
      Object.keys(emotionSpriteFiles).length +
      Object.keys(stateSpriteFiles).length;
    expect(allAlphaSpriteFiles).toHaveLength(expectedCount);
  });
});
