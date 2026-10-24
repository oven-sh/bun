// A typed function is handed to text that becomes code at run time, and called from there: unions that instanceof, in and truthiness tell apart.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
class A { a = 1 } class B { b = 2 }
function probe(v: A | B, w: Point | { z: number }, p?: Point): number {
  let n = v instanceof A ? v.a : v.b;
  n += "x" in w ? w.x : w.z;
  if (p) n += p.y;
  return n;
}
console.log(open(probe)(new A, { z: 3 }, pointAt(1)), open(probe)(new B, pointAt(1)));
