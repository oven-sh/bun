// A literal passed to a generic function, which keeps it in a place of type `unknown`. It comes back through a cast that is true, and stores that the cast's type allows are not refused because of what the literal started with.
interface Leaf { id: number; tag?: string }
const leaf = (id: number): Leaf => ({ id });
interface Base { node: unknown }
function keep<T>(node: T): Base {
  return { node };
}
function keepThrough<U>(node: U): Base {
  return keep(node);
}
const kept: unknown[] = [];
function remember<T>(value: T): T {
  kept.push(value);
  return value;
}
interface Wanted { kind: Leaf; next?: number | string; deep: { n: number; extra?: string } }
const first = keep({ kind: { id: 1, tag: "t" }, next: 1, deep: { n: 1, extra: "e" } }).node as Wanted;
const second = keepThrough({ kind: { id: 2, tag: "u" }, next: 2, deep: { n: 2, extra: "f" } }).node as Wanted;
const named = { kind: { id: 3, tag: "v" }, next: 3, deep: { n: 3, extra: "g" } };
const third = keep(named).node as Wanted;
const remembered = remember({ kind: { id: 4, tag: "w" }, next: 4, deep: { n: 4, extra: "h" } });
const fourth = kept[0] as Wanted;
for (const back of [first, second, third, fourth]) {
  back.kind = leaf(10);
  back.next = "ten";
  back.deep = { n: 10 };
  console.log(back.kind.id, back.kind.tag, back.next, back.deep.n, back.deep.extra, JSON.stringify(back));
}
console.log(named.kind.id, named.kind.tag, String(named.next), remembered.kind.id, remembered.deep.extra);
