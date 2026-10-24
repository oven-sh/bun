// A typed function is handed to text that becomes code at run time, and called from there: a callback whose parameter gets its type from the context.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
function probe(points: Point[]): number {
  let sum = 0;
  points.forEach(p => { sum += p.x; });
  return sum + points.map(p => p.y).reduce((a, b) => a + b, 0);
}
console.log(open(probe)([pointAt(1), pointAt(2)]));
