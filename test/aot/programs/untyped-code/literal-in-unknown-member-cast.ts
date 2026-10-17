// The literal comes back through casts that are true, of the value and of what holds it. Stores that the cast's type allows are not refused because of what the literal started with.
interface Leaf { id: number; tag?: string }
const leaf = (id: number): Leaf => ({ id });
interface Base { flags: number; node: unknown }
interface Node { kind: Leaf; next?: number | string; free: unknown }
interface Holder extends Base { node: Node }
function isHolder(b: Base): b is Holder {
  return b.flags === 1;
}
function get<T>(b: Base): T {
  return b.node as T;
}
const b: Base = { flags: 1, node: { kind: { id: 1, tag: "t" }, next: 1, free: [1, { in: 2 }] } };
const held = b as Holder;
console.log(held.node.kind.id, held.node.kind.tag, held.node.next);
held.node.kind = leaf(2);
held.node.next = "two";
held.node.free = "free";
console.log(held.node.kind.id, held.node.kind.tag, held.node.next, JSON.stringify(b));
(b.node as Node).kind = { id: 3 };
get<Node>(b).free = 4;
if (isHolder(b)) b.node.next = 5;
console.log(held.node.kind.id, held.node.kind.tag, JSON.stringify(b));
const parsed = JSON.parse('{"kind":{"id":9},"free":null}') as Node;
console.log(parsed.kind.id, parsed.free);
