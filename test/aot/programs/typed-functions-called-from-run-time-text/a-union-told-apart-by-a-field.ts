// A typed function is handed to text that becomes code at run time, and called from there: a union whose members are told apart by a field.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
type S = { kind: "a"; x: number } | { kind: "b"; y: string };
function probe(s: S): number {
  if (s.kind === "a") return s.x + 1;
  return s.y.length;
}
const f = open(probe);
console.log(f({ kind: "a", x: 1 }), f({ kind: "b", y: "yy" }));
