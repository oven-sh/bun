// Made as less, cast, then filled: a factory makes the common part, the caller stores the rest. The object is born with the room that its `kind` calls for: a smaller type lists the 3.
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Node { readonly kind: number; readonly parent: Node | undefined }
interface Small extends Node { readonly kind: 3 | 6; readonly name: string }
interface Big extends Node { readonly name: string; readonly a: Node; readonly b: Node; readonly c: Node; readonly d: Node; readonly e: Node; readonly f: Node; readonly g: Node; readonly h: Node }
interface Big3 extends Big { readonly kind: 3 }
interface Big4 extends Big { readonly kind: 4 }
function NodeObject(this: Mutable<Node>, kind: number) { this.kind = kind; this.parent = undefined; }
const Make = NodeObject as any as new (kind: number) => Node;
function base<T extends Node>(kind: T["kind"]) { return new Make(kind) as Mutable<T>; }
function small(name: string): Small { const node = base<Small>(6); node.name = name; return node; }
function fill(node: Mutable<Big>, name: string, x: Node) { node.name = name; node.a = x; node.b = x; node.c = x; node.d = x; node.e = x; node.f = x; node.g = x; node.h = x; }
function big3(name: string, x: Node): Big3 { const node = base<Big3>(3); fill(node, name, x); return node; }
function big4(name: string, x: Node): Big4 { const node = base<Big4>(4); fill(node, name, x); return node; }
function show(big: Big): string { return big.kind + big.name + big.a.kind + big.h.kind; }
const s = small("s");
console.log(s.name, show(big4("four", s)), show(big3("three", s)));
