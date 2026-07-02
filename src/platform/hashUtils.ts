/** DJB2-style string hash; callers apply modulo or scaling as needed. */
export function hashStringDjb2(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}
