// Recursion: each turn passes another kind of value, goes one name deeper, or swaps its parameters.
class Leaf {
  constructor(public value: number) {}
}
class Branch {
  constructor(public left: Tree, public right: Tree) {}
}
type Tree = Leaf | Branch;
function leftmost(tree: Tree): Leaf {
  return tree instanceof Leaf ? tree : leftmost(tree.left);
}
function sum(tree: Tree): number {
  return tree instanceof Leaf ? tree.value : sum(tree.left) + sum(tree.right);
}
function alternate<A, B>(a: A, b: B, turns: number): A | B {
  return turns === 0 ? a : alternate(b, a, turns - 1);
}
interface Link<T> {
  value: T;
  next: Link<T> | undefined;
}
function lastOf<T>(link: Link<T>): T {
  return link.next === undefined ? link.value : lastOf(link.next);
}
function wrap(value: unknown, depth: number): unknown {
  return depth === 0 ? value : wrap({ inner: value }, depth - 1);
}
function unwrap(value: any): unknown {
  return typeof value === "object" && value !== null && "inner" in value ? unwrap(value.inner) : value;
}
function walk(tree: Tree, visit: (leaf: Leaf) => void): void {
  if (tree instanceof Leaf) visit(tree);
  else {
    walk(tree.left, visit);
    walk(tree.right, leaf => visit(new Leaf(leaf.value * 10)));
  }
}
const tree = new Branch(new Branch(new Leaf(1), new Leaf(2)), new Branch(new Leaf(3), new Branch(new Leaf(4), new Leaf(5))));
const lines: string[] = [];
lines.push(String(leftmost(tree).value), String(sum(tree)));
for (let turns = 0; turns < 4; turns++) {
  const answer = alternate(new Leaf(7), "text", turns);
  lines.push(typeof answer === "string" ? answer : "leaf " + answer.value);
}
lines.push(String(lastOf({ value: 1, next: { value: 2, next: { value: 3, next: { value: 4, next: { value: 5, next: undefined } } } } })));
lines.push(lastOf({ value: "a", next: { value: "b", next: undefined } }));
lines.push(lastOf({ value: new Leaf(9), next: undefined }).value.toString());
lines.push(String(unwrap(wrap(5, 6))), (unwrap(wrap(new Leaf(8), 4)) as Leaf).value.toString(), String(unwrap(wrap("s", 0))));
const seen: number[] = [];
walk(tree, leaf => seen.push(leaf.value));
lines.push(seen.join());
console.log(lines.join("\n"));
