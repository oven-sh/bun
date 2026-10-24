// A typed function is handed to text that becomes code at run time, and called from there: a parameter of a function type and a method of an interface.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
type Measure = (p: Point) => number;
interface Maker { make(i: number): Point }
function probe(f: Measure, m: Maker, p: Point): number {
  return f(p) + 1 + m.make(1).x;
}
console.log(open(probe)(p => p.x, { make: pointAt }, pointAt(1)));
