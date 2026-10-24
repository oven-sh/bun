let held: number = 1;
function describe(): string {
  if (held === null) return "null";
  return "not null";
}
const source: number[] = [2];
const wide: unknown[] = source;
wide.push(null);
console.log(describe());
held = source[1];
console.log(describe());
export {};
