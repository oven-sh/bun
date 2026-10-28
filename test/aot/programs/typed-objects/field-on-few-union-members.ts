// A field that one member of a union in six has is read through the union: from objects that have it, from objects that lack it, from an object that got a property of that name later, and from one that inherits it.
interface Leaf { kind: "leaf"; weight: number }
interface Pair { kind: "pair"; left: Tree; right: Tree; note?: string; depth: number }
interface Empty { kind: "empty" }
interface Marked { kind: "marked"; mark: boolean }
interface Named { kind: "named"; name: string }
interface Sized { kind: "sized"; size: number }
type Tree = Leaf | Pair | Empty | Marked | Named | Sized;

function noteOf(tree: Tree): string | undefined {
  return (tree as Pair).note;
}
function depthOf(tree: Tree): number {
  const depth = (tree as Pair).depth;
  return depth === undefined ? -1 : depth;
}
function hasLeft(tree: Tree): boolean {
  return !!(tree as Pair).left;
}
function describe(tree: Tree): string {
  return tree.kind + ":" + noteOf(tree) + ":" + depthOf(tree) + ":" + hasLeft(tree);
}

const empty: Empty = { kind: "empty" };
const trees: Tree[] = [
  { kind: "pair", left: empty, right: empty, note: "first", depth: 1 },
  { kind: "pair", left: empty, right: empty, depth: 2 },
  { kind: "leaf", weight: 3 },
  empty,
  { kind: "marked", mark: true },
  { kind: "named", name: "n" },
  { kind: "sized", size: 4 },
];
for (const tree of trees) console.log(describe(tree));

let mostlyThere = 0;
for (let i = 0; i < 3000; i++) mostlyThere += depthOf(trees[i % 2]) + (noteOf(trees[i % 2]) ?? "").length;
let mostlyLacking = 0;
for (let i = 0; i < 3000; i++) mostlyLacking += depthOf(trees[2 + (i % 5)]) + (noteOf(trees[2 + (i % 5)]) ?? "none").length;
console.log(mostlyThere, mostlyLacking);

const late: Leaf = { kind: "leaf", weight: 5 };
(late as any).note = "late";
(late as any).depth = 9;
console.log(describe(late));

const heir = Object.create({ note: "inherited", depth: 7 }) as Named;
heir.kind = "named";
heir.name = "heir";
console.log(describe(heir));
