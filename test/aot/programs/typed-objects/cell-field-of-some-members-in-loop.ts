// Only `Branch` has `child`, which always holds an object, and `Leaf` has a number in the same bytes. `Bare` has nothing where `Full` has `inner`. The receiver does not change inside the loops, so a load of the field that is free to move leaves the loop and the test that guards it. What it reads from a `Leaf` or a `Bare` is no object, and nothing may be read through it.
class Leaf { weight = 1.5; }
class Branch { child: Leaf; constructor(child: Leaf) { this.child = child; } }
type Tree = Leaf | Branch;
interface Holder { y: number; inner?: Leaf }
class Full implements Holder { y = 1; inner = new Leaf(); }
class Bare implements Holder { y = 2; }
function totalWeight(tree: Tree, count: number): number {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += "child" in tree ? tree.child.weight : tree.weight * 2;
    return sum;
}
function totalInner(holder: Holder, count: number): number {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += holder.inner ? holder.inner.weight : -holder.y;
    return sum;
}
const trees: Tree[] = [new Leaf(), new Branch(new Leaf())], holders: Holder[] = [new Bare(), new Full()];
for (let round = 0; round < 50; round++) for (let i = 0; i < 2; i++) { totalWeight(trees[i], 200); totalInner(holders[i], 200); }
console.log(totalWeight(trees[0], 1000), totalWeight(trees[1], 1000), totalInner(holders[0], 1000), totalInner(holders[1], 1000), totalWeight(trees[0], 0), totalInner(holders[0], 0));
export {};
