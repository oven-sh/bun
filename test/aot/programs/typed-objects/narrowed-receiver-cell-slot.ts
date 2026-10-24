// `tree` does not change in the loops, and `tree.child.value` is read only after a test narrows `tree` to `Branch`. A `Leaf` has a number in the bytes where a `Branch` has `child`, so hoisting the two loads out of a loop must not make the second one run on a `Leaf`.
class Inner { value: number; constructor(value: number) { this.value = value; } }
class Branch { kind: 1 = 1; child: Inner; constructor(value: number) { this.child = new Inner(value); } }
class Leaf { kind: 2 = 2; weight: number; constructor(weight: number) { this.weight = weight; } }
type Tree = Branch | Leaf;
function sumByClass(tree: Tree, rounds: number): number { let sum = 0; for (let i = 0; i < rounds; i++) sum += tree instanceof Branch ? tree.child.value : 1; return sum; }
function sumByKind(tree: Tree, rounds: number): number { let sum = 0; for (let i = 0; i < rounds; i++) sum += tree.kind === 1 ? tree.child.value : tree.weight > 0 ? 2 : 3; return sum; }
const trees: Tree[] = [new Branch(5), new Leaf(1.5e300), new Leaf(-7), new Branch(-2), new Leaf(0.1)];
let total = 0;
for (let round = 0; round < 2000; round++) for (const tree of trees) total += sumByClass(tree, 3) + sumByKind(tree, 3);
console.log(total, trees.map(tree => sumByClass(tree, 4)).join(), trees.map(tree => sumByKind(tree, 4)).join());
export {};
