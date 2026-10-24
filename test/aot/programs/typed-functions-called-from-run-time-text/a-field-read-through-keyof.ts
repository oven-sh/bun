// A typed function is handed to text that becomes code at run time, and called from there: a field read through a key of type keyof and a result of an indexed access type.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
function get<T, K extends keyof T>(o: T, k: K): T[K] { return o[k]; }
function probe(p: Point): number {
  const x = get(p, "x");
  return x + 1;
}
console.log(open(probe)(pointAt(1)));
