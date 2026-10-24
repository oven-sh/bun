// One constructor function makes the objects of interfaces that a literal `kind` tells apart. Each of them is born below what the `prototype` property of new.target holds at that moment.
const enum Kind { Leaf = 1, Pair = 2, Wrap = 3 }
interface Node { kind: Kind; pos: number }
interface Leaf extends Node { kind: Kind.Leaf; text: string }
interface Pair extends Node { kind: Kind.Pair; left: Node; right: Node }
interface Wrap extends Node { kind: Kind.Wrap; inner: Node }

function NodeObject(this: Node, kind: Kind, pos: number) {
  this.kind = kind;
  this.pos = pos;
}
const NodeConstructor = NodeObject as unknown as new (kind: Kind, pos: number) => Node;
(globalThis as any).NodeObject = NodeObject;

function create(kind: Kind, pos: number): Node {
  return new NodeConstructor(kind, pos);
}
function createLeaf(text: string, pos: number): Leaf {
  const node = new NodeConstructor(Kind.Leaf, pos) as Leaf;
  node.text = text;
  return node;
}
function describe(node: Node): string {
  const prototype = Object.getPrototypeOf(node);
  const name = prototype === first ? "first" : prototype === second ? "second" : prototype === Other.prototype ? "other" : prototype === Object.prototype ? "object" : "?";
  let isInstance: string;
  try { isInstance = String(node instanceof NodeConstructor); } catch (error) { isInstance = (error as Error).constructor.name; }
  return name + ":" + node.kind + ":" + node.pos + ":" + isInstance + ":" + String((node as any).label);
}

const first: any = (NodeObject as any).prototype;
const second: any = { label: "second" };
function Other() {}

let sum = 0;
let kept: Node = create(Kind.Leaf, -1);
for (let i = 0; i < 30000; i++) {
  const node = create(((i % 3) + 1) as Kind, i);
  sum += node.kind + createLeaf("x", i).text.length;
  if (i === 29999) kept = node;
}
console.log(sum, describe(kept), describe(createLeaf("a", 1)));

first.label = "first";
console.log(describe(kept), describe(create(Kind.Pair, 2)), describe(createLeaf("b", 3)));

console.log(describe(Reflect.construct(NodeObject, [Kind.Wrap, 4], Other)), describe(Reflect.construct(NodeObject, [Kind.Leaf, 5], NodeObject)));

(NodeObject as any).prototype = second;
for (let i = 0; i < 3; i++) console.log(describe(create(((i % 3) + 1) as Kind, i)), describe(createLeaf("c", i)), describe(kept));

(NodeObject as any).prototype = 7;
console.log(describe(create(Kind.Pair, 6)), describe(createLeaf("d", 7)));

(NodeObject as any).prototype = first;
console.log(describe(create(Kind.Wrap, 8)), describe(createLeaf("e", 9)), describe(create(9 as Kind, 10)));

const literal = { kind: Kind.Leaf, pos: 0 } as Node;
NodeObject.call(literal, Kind.Pair, 11);
console.log(describe(literal));
