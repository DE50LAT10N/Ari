import type { CharacterEmotion } from "../types/character";

export type EmotionVoiceProfile = {
  pitchMin: number;
  pitchMax: number;
  intervalMinMs: number;
  intervalMaxMs: number;
  volumeScale: number;
  blipDurationScale: number;
  rhythmJitter: number;
};

const profiles: Record<CharacterEmotion, EmotionVoiceProfile> = {
  neutral: {
    pitchMin: 0.95,
    pitchMax: 1.05,
    intervalMinMs: 45,
    intervalMaxMs: 70,
    volumeScale: 1,
    blipDurationScale: 1,
    rhythmJitter: 0.08,
  },
  happy: {
    pitchMin: 1.15,
    pitchMax: 1.35,
    intervalMinMs: 35,
    intervalMaxMs: 55,
    volumeScale: 1.05,
    blipDurationScale: 0.92,
    rhythmJitter: 0.12,
  },
  amused: {
    pitchMin: 1.1,
    pitchMax: 1.28,
    intervalMinMs: 38,
    intervalMaxMs: 62,
    volumeScale: 1,
    blipDurationScale: 0.95,
    rhythmJitter: 0.18,
  },
  annoyed: {
    pitchMin: 0.85,
    pitchMax: 0.95,
    intervalMinMs: 45,
    intervalMaxMs: 70,
    volumeScale: 0.95,
    blipDurationScale: 0.82,
    rhythmJitter: 0.06,
  },
  curious: {
    pitchMin: 1.02,
    pitchMax: 1.18,
    intervalMinMs: 42,
    intervalMaxMs: 68,
    volumeScale: 1,
    blipDurationScale: 1,
    rhythmJitter: 0.1,
  },
  empathetic: {
    pitchMin: 0.88,
    pitchMax: 0.98,
    intervalMinMs: 55,
    intervalMaxMs: 85,
    volumeScale: 0.9,
    blipDurationScale: 1.08,
    rhythmJitter: 0.05,
  },
  blush: {
    pitchMin: 1.05,
    pitchMax: 1.2,
    intervalMinMs: 48,
    intervalMaxMs: 72,
    volumeScale: 0.88,
    blipDurationScale: 1.02,
    rhythmJitter: 0.1,
  },
  bored: {
    pitchMin: 0.75,
    pitchMax: 0.9,
    intervalMinMs: 80,
    intervalMaxMs: 120,
    volumeScale: 0.75,
    blipDurationScale: 1.15,
    rhythmJitter: 0.04,
  },
  calm: {
    pitchMin: 0.92,
    pitchMax: 1.02,
    intervalMinMs: 60,
    intervalMaxMs: 90,
    volumeScale: 0.85,
    blipDurationScale: 1.1,
    rhythmJitter: 0.04,
  },
  surprised: {
    pitchMin: 1.2,
    pitchMax: 1.45,
    intervalMinMs: 30,
    intervalMaxMs: 50,
    volumeScale: 1.1,
    blipDurationScale: 0.78,
    rhythmJitter: 0.14,
  },
  sad: {
    pitchMin: 0.82,
    pitchMax: 0.92,
    intervalMinMs: 65,
    intervalMaxMs: 95,
    volumeScale: 0.82,
    blipDurationScale: 1.12,
    rhythmJitter: 0.04,
  },
  sleepy: {
    pitchMin: 0.72,
    pitchMax: 0.88,
    intervalMinMs: 90,
    intervalMaxMs: 130,
    volumeScale: 0.7,
    blipDurationScale: 1.2,
    rhythmJitter: 0.03,
  },
  excited: {
    pitchMin: 1.22,
    pitchMax: 1.42,
    intervalMinMs: 28,
    intervalMaxMs: 48,
    volumeScale: 1.12,
    blipDurationScale: 0.85,
    rhythmJitter: 0.16,
  },
  pensive: {
    pitchMin: 0.9,
    pitchMax: 1.02,
    intervalMinMs: 58,
    intervalMaxMs: 88,
    volumeScale: 0.88,
    blipDurationScale: 1.06,
    rhythmJitter: 0.06,
  },
  worried: {
    pitchMin: 0.86,
    pitchMax: 0.98,
    intervalMinMs: 52,
    intervalMaxMs: 78,
    volumeScale: 0.86,
    blipDurationScale: 1.05,
    rhythmJitter: 0.07,
  },
  proud: {
    pitchMin: 1.08,
    pitchMax: 1.22,
    intervalMinMs: 40,
    intervalMaxMs: 62,
    volumeScale: 1.04,
    blipDurationScale: 0.94,
    rhythmJitter: 0.1,
  },
  shy: {
    pitchMin: 1.0,
    pitchMax: 1.12,
    intervalMinMs: 52,
    intervalMaxMs: 78,
    volumeScale: 0.8,
    blipDurationScale: 1.04,
    rhythmJitter: 0.08,
  },
  determined: {
    pitchMin: 0.94,
    pitchMax: 1.04,
    intervalMinMs: 44,
    intervalMaxMs: 66,
    volumeScale: 0.96,
    blipDurationScale: 0.96,
    rhythmJitter: 0.05,
  },
};

export function getEmotionVoiceProfile(
  emotion: CharacterEmotion = "neutral",
): EmotionVoiceProfile {
  return profiles[emotion] ?? profiles.neutral;
}

export function samplePitch(profile: EmotionVoiceProfile): number {
  return (
    profile.pitchMin +
    Math.random() * (profile.pitchMax - profile.pitchMin)
  );
}

export function sampleInterval(profile: EmotionVoiceProfile): number {
  const base =
    profile.intervalMinMs +
    Math.random() * (profile.intervalMaxMs - profile.intervalMinMs);
  const jitter = 1 + (Math.random() * 2 - 1) * profile.rhythmJitter;
  return Math.round(base * jitter);
}
