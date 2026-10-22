// What a written cast yields may be any object, so a read through it tests the shape. The reads that follow share the test, and behind it they yield what the field holds: no conversion is left.
// IRT= 1 sumOfLeaf TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 maybe TypeTest v[0-9]+ testedType=L[0-9]+!
interface Leaf { n: number; m: number; k: number }
interface Base { kind: number }
interface Holder extends Base { leaf: Leaf; other: number }
interface Empty extends Base { none: boolean }
function holder(i: number): Holder { return { kind: 1, leaf: { n: i + 0.5, m: i + 1.5, k: i + 2.5 }, other: i } }
function empty(): Empty { return { kind: 2, none: true } }
function sumOfLeaf(b: Base): number { const l = (b as Holder).leaf; return l.n + l.m + l.k }
function maybe(b: Base): number { const l = (b as Holder).leaf; return l ? l.n + l.m : -1 }
const table = [sumOfLeaf, maybe];
(globalThis as { kept?: unknown }).kept = table;
let s = 0;
for (let i = 0; i < 20; i++) { s += sumOfLeaf(holder(i)) + maybe(i % 3 ? holder(i) : empty()) + table[1](holder(i)); }
console.log(s);
