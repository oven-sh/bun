// A typed function is handed to text that becomes code at run time, and called from there: objects with an index signature.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
function probe(counts: Record<string, number>, points: { [k: string]: Point }, k: string): number {
  const p = points[k];
  return counts[k] + counts.a + p.x + points.a.y;
}
console.log(open(probe)({ a: 1 }, { a: pointAt(1) }, "a"));
