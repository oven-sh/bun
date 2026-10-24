// A typed function is handed to text that becomes code at run time, and called from there: a Promise, a Map and a Set of a declared type.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
async function load(i: number): Promise<Point> { return pointAt(i); }
async function probe(map: Map<string, Point>, set: Set<Point>, pending: Promise<Point>): Promise<number> {
  let n = (await open(load)(1)).x + (await pending).y + map.get("a")!.x;
  for (const [, v] of map) n += v.y;
  for (const v of set) n += v.x;
  return n;
}
open(probe)(new Map([["a", pointAt(1)]]), new Set([pointAt(2)]), load(3)).then(console.log);
