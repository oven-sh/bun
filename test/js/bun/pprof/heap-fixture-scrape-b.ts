type Kept = ArrayBuffer[];
interface Unused {
  field: string;
}

export function allocateLater(kept: Kept): void {
  const size: number = 2 * 1024 * 1024;
  kept.push(new ArrayBuffer(size)); // line 8
}
