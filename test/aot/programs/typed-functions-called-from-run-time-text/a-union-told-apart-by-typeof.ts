// A typed function is handed to text that becomes code at run time, and called from there: a union that typeof tells apart.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function probe(v: string | number): number {
  if (typeof v === "string") return v.length;
  return v + 1;
}
const f = open(probe);
console.log(f("abc"), f(1));
