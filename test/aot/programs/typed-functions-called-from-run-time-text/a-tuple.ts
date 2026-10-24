// A typed function is handed to text that becomes code at run time, and called from there: a tuple that is read by index and taken apart by a pattern.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
function probe(t: [number, string, Point]): number {
  const [a, b, c] = t;
  return t[0] + t[1].length + t[2].x + a + b.length + c.y;
}
console.log(open(probe)([1, "ab", pointAt(1)]));
