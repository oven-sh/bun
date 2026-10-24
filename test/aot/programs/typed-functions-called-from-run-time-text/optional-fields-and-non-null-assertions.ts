// A typed function is handed to text that becomes code at run time, and called from there: optional fields, optional parameters and non-null assertions.
interface Point { x: number; y: number }
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
interface Node { value: number; next?: Node; at: Point | null }
function probe(n: Node): number {
  return n.value + (n.next?.value ?? 0) + n.at!.x + (n.next ? n.next.value : 0);
}
console.log(open(probe)({ value: 1, next: { value: 2, at: null }, at: pointAt(1) }));
