// A typed function is handed to text that becomes code at run time, and called from there: a value that a function with a type predicate narrows.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
function isPoint(v: unknown): v is Point { return typeof v === "object" && v !== null && "x" in v; }
function probe(v: unknown): number {
  if (isPoint(v)) return v.x + v.y;
  return 0;
}
console.log(open(probe)(pointAt(1)), open(probe)(1));
