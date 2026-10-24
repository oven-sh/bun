// A typed function is handed to text that becomes code at run time, and called from there: the result of a function whose return type is inferred.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function make(i: number) { return { x: i, y: String(i) }; }
function pick(i: number) { return i > 0 ? make(i) : undefined; }
function probe(i: number): number {
  const m = open(make)(i);
  const q = open(pick)(i);
  return m.x + m.y.length + (q ? q.x : 0);
}
console.log(open(probe)(1));
