// A typed function is handed to text that becomes code at run time, and called from there: a union that a switch over a field tells apart.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
interface Square { kind: 0; side: number } interface Circle { kind: 1; r: number } interface Re { kind: 2; w: number; h: number }
function probe(s: Square | Circle | Re): number {
  switch (s.kind) {
    case 0: return s.side * s.side;
    case 1: return s.r * 3;
    default: return s.w * s.h;
  }
}
const f = open(probe);
console.log(f({ kind: 0, side: 2 }), f({ kind: 1, r: 1 }), f({ kind: 2, w: 2, h: 3 }));
