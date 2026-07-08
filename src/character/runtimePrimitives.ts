export type Clock = {
  now: () => number;
};

export type RandomSource = {
  next: () => number;
};

export const systemClock: Clock = {
  now: () => Date.now(),
};

export const systemRandom: RandomSource = {
  next: () => Math.random(),
};

export function randomChance(
  random: RandomSource,
  probability: number,
): boolean {
  if (probability <= 0) {
    return false;
  }
  if (probability >= 1) {
    return true;
  }
  return random.next() < probability;
}

export function randomJitterMs(
  random: RandomSource,
  baseMs: number,
  spreadMs: number,
): number {
  return baseMs + Math.floor(random.next() * Math.max(0, spreadMs));
}

export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    },
  };
}
