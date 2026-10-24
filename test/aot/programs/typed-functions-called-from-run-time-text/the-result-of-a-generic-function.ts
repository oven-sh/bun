// A typed function is handed to text that becomes code at run time, and called from there: the result of a generic function that is instantiated at the call.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
function first<T>(list: T[]): T { return list[0]; }
function probe(points: Point[]): number {
  const p = first(points);
  return p.x + p.y;
}
console.log(open(probe)([pointAt(1), pointAt(2)]));
