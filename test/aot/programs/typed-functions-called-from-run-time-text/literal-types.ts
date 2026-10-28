// A typed function is handed to text that becomes code at run time, and called from there: parameters of literal types.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
type Dir = "up" | "down";
function probe(d: Dir, n: 1 | 2 | 3, b: true): number {
  const step = d === "up" ? 1 : -1;
  return step * n + (b ? 1 : 0) + n * n;
}
console.log(open(probe)("up", 2, true));
