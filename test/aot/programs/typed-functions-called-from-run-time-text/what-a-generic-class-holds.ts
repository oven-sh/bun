// A typed function is handed to text that becomes code at run time, and called from there: what an instance of a generic class holds and hands out.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
class Box<T> { constructor(public held: T) {} get(): T { return this.held; } }
function probe(box: Box<Point>): number {
  return box.get().x + box.held.y;
}
console.log(open(probe)(new Box(pointAt(1))), new Box("s").get());
