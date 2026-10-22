// switch (n.kind) and n.kind === K say which objects n can be: what one case stores lands on that kind alone, and the keys of the others stay as they were.
const enum Kind { A = 1, B = 2, C = 3 }
interface Base { kind: Kind; pos: number }
interface NodeA extends Base { kind: Kind.A; a: number }
interface NodeB extends Base { kind: Kind.B; b: string }
interface NodeC extends Base { kind: Kind.C; c: Node | undefined }
type Node = NodeA | NodeB | NodeC;
function NodeObject(this: Base, kind: Kind, pos: number) { this.kind = kind; this.pos = pos }
const NodeConstructor = NodeObject as any as new (kind: Kind, pos: number) => Base;
function createA(a: number): NodeA { const n = new NodeConstructor(Kind.A, 0) as NodeA; n.a = a; return n }
function createB(b: string): NodeB { const n = new NodeConstructor(Kind.B, 0) as NodeB; n.b = b; return n }
function createC(c: Node | undefined): NodeC { const n = new NodeConstructor(Kind.C, 0) as NodeC; n.c = c; return n }
function weigh(n: Node): number {
  switch (n.kind) {
    case Kind.A: return n.a;
    case Kind.B: return n.b.length;
    case Kind.C: return n.c ? weigh(n.c) + 1 : 0;
  }
}
function mark(n: Node) {
  if (n.kind === Kind.A) (n as any).markedA = true;
  else if (n.kind === Kind.B) (n as any).markedB = true;
}
const all: Node[] = [];
for (let i = 0; i < 30; i++) all.push(i % 3 === 0 ? createA(i) : i % 3 === 1 ? createB("s" + i) : createC(all[i - 1]));
let total = 0;
for (const n of all) { mark(n); total += weigh(n) }
console.log(total, Object.keys(all[0]!).join(), Object.keys(all[1]!).join(), Object.keys(all[2]!).join());
