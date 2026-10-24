// Four factories construct one constructor function and store names of their own on the object. Each kind has its own size, and nothing else tells it from its siblings:
// prototype, instanceof, key order, in, delete, a late name, freeze, spread, JSON.stringify and structuredClone answer as for any object.
enum SyntaxKind { Unknown, K0, K1, K2, K3 }
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Node { readonly kind: SyntaxKind; readonly pos: number; readonly end: number; readonly parent: Node; flags: number; id?: number }
interface N0 extends Node { readonly kind: SyntaxKind.K0; readonly a0: Node | undefined; readonly b0: number; readonly c0: string }
interface N1 extends Node { readonly kind: SyntaxKind.K1; readonly a1: Node | undefined; readonly b1: number; readonly c1: string }
interface N2 extends Node { readonly kind: SyntaxKind.K2; readonly a2: Node | undefined; readonly b2: number; readonly c2: string }
interface N3 extends Node { readonly kind: SyntaxKind.K3; readonly a3: Node | undefined; readonly b3: number; readonly c3: string }
function NodeObject(this: Mutable<Node>, kind: SyntaxKind, pos: number, end: number) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.id = 0;
  this.flags = 0;
  this.parent = undefined!;
}
NodeObject.prototype.describe = function (this: Node) { return "node " + this.kind; };
const NodeConstructor = NodeObject as any as new (kind: SyntaxKind, pos: number, end: number) => Node;
function create0(a: Node | undefined, b: number, c: string): N0 {
  const node = new NodeConstructor(SyntaxKind.K0, -1, -1) as Mutable<N0>;
  node.a0 = a;
  node.b0 = b;
  node.c0 = c;
  return node;
}
function create1(a: Node | undefined, b: number, c: string): N1 {
  const node = new NodeConstructor(SyntaxKind.K1, -1, -1) as Mutable<N1>;
  node.a1 = a;
  node.b1 = b;
  node.c1 = c;
  return node;
}
function create2(a: Node | undefined, b: number, c: string): N2 {
  const node = new NodeConstructor(SyntaxKind.K2, -1, -1) as Mutable<N2>;
  node.a2 = a;
  node.b2 = b;
  node.c2 = c;
  return node;
}
function create3(a: Node | undefined, b: number, c: string): N3 {
  const node = new NodeConstructor(SyntaxKind.K3, -1, -1) as Mutable<N3>;
  node.a3 = a;
  node.b3 = b;
  node.c3 = c;
  return node;
}
function weigh(node: Node | undefined): number {
  if (!node) return 0;
  switch (node.kind) {
    case SyntaxKind.K0: { const n = node as N0; return n.b0 + n.c0.length + weigh(n.a0); }
    case SyntaxKind.K1: { const n = node as N1; return n.b1 + n.c1.length + weigh(n.a1); }
    case SyntaxKind.K2: { const n = node as N2; return n.b2 + n.c2.length + weigh(n.a2); }
    case SyntaxKind.K3: { const n = node as N3; return n.b3 + n.c3.length + weigh(n.a3); }
  }
  return -1;
}
let tree: Node | undefined = undefined;
for (let round = 0; round < 3; round++) {
  tree = create0(tree, 0 + round, "s0");
  tree = create1(tree, 1 + round, "s1");
  tree = create2(tree, 2 + round, "s2");
  tree = create3(tree, 3 + round, "s3");
}
console.log(weigh(tree));
const last = tree!;
console.log(Object.keys(last).join(","));
console.log(JSON.stringify({ ...last, a3: undefined }));
console.log(last instanceof (NodeObject as any), Object.getPrototypeOf(last) === NodeObject.prototype, (last as any).describe());
console.log((last as any).a0, "b0" in last, "b3" in last, Object.prototype.hasOwnProperty.call(last, "c3"));
(last as any).late = 7;
delete (last as any).b3;
console.log(Object.keys(last).join(","), (last as any).late, (last as any).b3);
Object.freeze(last);
console.log(Object.isFrozen(last), structuredClone({ ...last, a3: undefined, parent: undefined }).kind);
