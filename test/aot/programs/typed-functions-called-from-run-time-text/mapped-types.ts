// A typed function is handed to text that becomes code at run time, and called from there: Partial, Pick, Omit, Readonly and Required.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
interface P3 extends Point { z: number; name: string }
function probe(a: Partial<Point>, b: Pick<P3, "x" | "z">, c: Readonly<Point>, d: Omit<P3, "name">, e: Required<Partial<Point>>): number {
  return (a.x ?? 0) + b.x + b.z + c.y + d.z + e.x;
}
console.log(open(probe)({ x: 1 }, { x: 1, z: 2 }, pointAt(1), { x: 1, y: 2, z: 3 }, pointAt(2)));
