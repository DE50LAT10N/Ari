export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampSignedUnit(value: number): number {
  return clamp(value, -1, 1);
}

export function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

export function clamp01(value: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return clamp(value, 0, 1);
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function clipWeight(value: number, limit: number): number {
  return clamp(value, -limit, limit);
}
