// A typed function is handed to text that becomes code at run time, and called from there: ReturnType, NonNullable, Awaited, Parameters, Extract and a conditional type of its own.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
function make() { return pointAt(1); }
type Elem<T> = T extends (infer U)[] ? U : never;
function probe(a: ReturnType<typeof make>, b: Elem<Point[]>, c: NonNullable<Point | null>, d: Awaited<Promise<Point>>, e: Parameters<typeof pointAt>[0], f: Extract<Point | string, object>): number {
  return a.x + b.x + c.x + d.x + e + f.x;
}
console.log(open(probe)(make(), pointAt(1), pointAt(1), pointAt(1), 1, pointAt(1)));
