// The object comes up a chain of helpers: factory, base declaration, base node, a method of an object that was passed in, new. Only the factory says what kind it is.
enum SyntaxKind { Unknown, K0, K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11 }
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Node { readonly kind: SyntaxKind; readonly pos: number; readonly end: number; readonly parent: Node; flags: number; id?: number }
interface Declaration extends Node { symbol: object | undefined; localSymbol: object | undefined }
interface N0 extends Node { readonly kind: SyntaxKind.K0; readonly a0: Node | undefined; readonly b0: number; readonly c0: string }
interface N1 extends Declaration { readonly kind: SyntaxKind.K1; readonly a1: Node | undefined; readonly b1: number; readonly c1: string }
interface N2 extends Node { readonly kind: SyntaxKind.K2; readonly a2: Node | undefined; readonly b2: number; readonly c2: string }
interface N3 extends Declaration { readonly kind: SyntaxKind.K3; readonly a3: Node | undefined; readonly b3: number; readonly c3: string }
interface N4 extends Node { readonly kind: SyntaxKind.K4; readonly a4: Node | undefined; readonly b4: number; readonly c4: string }
interface N5 extends Declaration { readonly kind: SyntaxKind.K5; readonly a5: Node | undefined; readonly b5: number; readonly c5: string }
interface N6 extends Node { readonly kind: SyntaxKind.K6; readonly a6: Node | undefined; readonly b6: number; readonly c6: string }
interface N7 extends Declaration { readonly kind: SyntaxKind.K7; readonly a7: Node | undefined; readonly b7: number; readonly c7: string }
interface N8 extends Node { readonly kind: SyntaxKind.K8; readonly a8: Node | undefined; readonly b8: number; readonly c8: string }
interface N9 extends Declaration { readonly kind: SyntaxKind.K9; readonly a9: Node | undefined; readonly b9: number; readonly c9: string }
interface N10 extends Node { readonly kind: SyntaxKind.K10; readonly a10: Node | undefined; readonly b10: number; readonly c10: string }
interface N11 extends Declaration { readonly kind: SyntaxKind.K11; readonly a11: Node | undefined; readonly b11: number; readonly c11: string }
function NodeObject(this: Mutable<Node>, kind: SyntaxKind, pos: number, end: number) {
  this.pos = pos;
  this.end = end;
  this.kind = kind;
  this.id = 0;
  this.flags = 0;
  this.parent = undefined!;
}
const objectAllocator = { getNodeConstructor: () => NodeObject as any as new (kind: SyntaxKind, pos: number, end: number) => Node };
interface BaseNodeFactory { createBaseNode(kind: SyntaxKind): Node }
function createBaseNodeFactory(): BaseNodeFactory {
  let NodeConstructor: new (kind: SyntaxKind, pos: number, end: number) => Node;
  return { createBaseNode };
  function createBaseNode(kind: SyntaxKind): Node {
    return new (NodeConstructor || (NodeConstructor = objectAllocator.getNodeConstructor()))(kind, -1, -1);
  }
}
function createNodeFactory(baseFactory: BaseNodeFactory) {
  return { create0, create1, create2, create3, create4, create5, create6, create7, create8, create9, create10, create11 };
  function createBaseNode<T extends Node>(kind: T["kind"]) {
    return baseFactory.createBaseNode(kind) as Mutable<T>;
  }
  function createBaseDeclaration<T extends Declaration>(kind: T["kind"]) {
    const node = createBaseNode(kind);
    node.symbol = undefined!;
    node.localSymbol = undefined;
    return node;
  }
  function create0(a: Node | undefined, b: number, c: string): N0 {
    const node = createBaseNode<N0>(SyntaxKind.K0);
    node.a0 = a;
    node.b0 = b;
    node.c0 = c;
    return node;
  }
  function create1(a: Node | undefined, b: number, c: string): N1 {
    const node = createBaseDeclaration<N1>(SyntaxKind.K1);
    node.a1 = a;
    node.b1 = b;
    node.c1 = c;
    return node;
  }
  function create2(a: Node | undefined, b: number, c: string): N2 {
    const node = createBaseNode<N2>(SyntaxKind.K2);
    node.a2 = a;
    node.b2 = b;
    node.c2 = c;
    return node;
  }
  function create3(a: Node | undefined, b: number, c: string): N3 {
    const node = createBaseDeclaration<N3>(SyntaxKind.K3);
    node.a3 = a;
    node.b3 = b;
    node.c3 = c;
    return node;
  }
  function create4(a: Node | undefined, b: number, c: string): N4 {
    const node = createBaseNode<N4>(SyntaxKind.K4);
    node.a4 = a;
    node.b4 = b;
    node.c4 = c;
    return node;
  }
  function create5(a: Node | undefined, b: number, c: string): N5 {
    const node = createBaseDeclaration<N5>(SyntaxKind.K5);
    node.a5 = a;
    node.b5 = b;
    node.c5 = c;
    return node;
  }
  function create6(a: Node | undefined, b: number, c: string): N6 {
    const node = createBaseNode<N6>(SyntaxKind.K6);
    node.a6 = a;
    node.b6 = b;
    node.c6 = c;
    return node;
  }
  function create7(a: Node | undefined, b: number, c: string): N7 {
    const node = createBaseDeclaration<N7>(SyntaxKind.K7);
    node.a7 = a;
    node.b7 = b;
    node.c7 = c;
    return node;
  }
  function create8(a: Node | undefined, b: number, c: string): N8 {
    const node = createBaseNode<N8>(SyntaxKind.K8);
    node.a8 = a;
    node.b8 = b;
    node.c8 = c;
    return node;
  }
  function create9(a: Node | undefined, b: number, c: string): N9 {
    const node = createBaseDeclaration<N9>(SyntaxKind.K9);
    node.a9 = a;
    node.b9 = b;
    node.c9 = c;
    return node;
  }
  function create10(a: Node | undefined, b: number, c: string): N10 {
    const node = createBaseNode<N10>(SyntaxKind.K10);
    node.a10 = a;
    node.b10 = b;
    node.c10 = c;
    return node;
  }
  function create11(a: Node | undefined, b: number, c: string): N11 {
    const node = createBaseDeclaration<N11>(SyntaxKind.K11);
    node.a11 = a;
    node.b11 = b;
    node.c11 = c;
    return node;
  }
}
const factory = createNodeFactory(createBaseNodeFactory());
function weigh(node: Node | undefined): number {
  if (!node) return 0;
  switch (node.kind) {
    case SyntaxKind.K0: { const n = node as N0; return n.b0 + n.c0.length + weigh(n.a0); }
    case SyntaxKind.K1: { const n = node as N1; return n.b1 + n.c1.length + weigh(n.a1); }
    case SyntaxKind.K2: { const n = node as N2; return n.b2 + n.c2.length + weigh(n.a2); }
    case SyntaxKind.K3: { const n = node as N3; return n.b3 + n.c3.length + weigh(n.a3); }
    case SyntaxKind.K4: { const n = node as N4; return n.b4 + n.c4.length + weigh(n.a4); }
    case SyntaxKind.K5: { const n = node as N5; return n.b5 + n.c5.length + weigh(n.a5); }
    case SyntaxKind.K6: { const n = node as N6; return n.b6 + n.c6.length + weigh(n.a6); }
    case SyntaxKind.K7: { const n = node as N7; return n.b7 + n.c7.length + weigh(n.a7); }
    case SyntaxKind.K8: { const n = node as N8; return n.b8 + n.c8.length + weigh(n.a8); }
    case SyntaxKind.K9: { const n = node as N9; return n.b9 + n.c9.length + weigh(n.a9); }
    case SyntaxKind.K10: { const n = node as N10; return n.b10 + n.c10.length + weigh(n.a10); }
    case SyntaxKind.K11: { const n = node as N11; return n.b11 + n.c11.length + weigh(n.a11); }
  }
  return -1;
}
let tree: Node | undefined = undefined;
for (let round = 0; round < 3; round++) {
  tree = factory.create0(tree, 0 + round, "s0");
  tree = factory.create1(tree, 1 + round, "s1");
  tree = factory.create2(tree, 2 + round, "s2");
  tree = factory.create3(tree, 3 + round, "s3");
  tree = factory.create4(tree, 4 + round, "s4");
  tree = factory.create5(tree, 5 + round, "s5");
  tree = factory.create6(tree, 6 + round, "s6");
  tree = factory.create7(tree, 7 + round, "s7");
  tree = factory.create8(tree, 8 + round, "s8");
  tree = factory.create9(tree, 9 + round, "s9");
  tree = factory.create10(tree, 10 + round, "s10");
  tree = factory.create11(tree, 11 + round, "s11");
}
console.log(weigh(tree), Object.keys(tree!).join(","));
