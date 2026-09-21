type Kept = ArrayBuffer[];

export function allocateInLongNamedModule(kept: Kept): void {
  kept.push(new ArrayBuffer(2 * 1024 * 1024));
}
