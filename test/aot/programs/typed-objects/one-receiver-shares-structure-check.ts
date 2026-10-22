// Point also admits objects from elsewhere, so an access through it tests the shape of the receiver. An object that was created as a Point stays one, so the accesses to one receiver share one test, calls between them included.
// IRT= 1 fourReads TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 fourStores TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 2 twoReceivers TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 inBranches TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 inLoop TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 1 aroundCall TypeTest v[0-9]+ testedType=L[0-9]+!
// IRT= 2 nested TypeTest v[0-9]+ testedType=L[0-9]+!
// MESSAGE-DATA< 3
interface Inner { v: number; w: number }
interface Point { x: number; y: number; z: number; w: number; inner: Inner }
function make(i: number): Point { return { x: i + 0.5, y: i + 1.5, z: i + 2.5, w: i + 3.5, inner: { v: i, w: i + 1 } } }
function elsewhere(i: number): Point { const made: any = { w: i + 3.25, z: i + 2.25, y: i + 1.25, x: i + 0.25, inner: { w: i + 2, v: i + 1 }, more: true }; return made }
let calls = 0;
function count(): void { calls++ }

function fourReads(o: Point): number { return o.x + o.y + o.z + o.w }
function fourStores(o: Point, n: number): void { o.x = n; o.y = n + 1; o.z = n + 2; o.w = n + 3 }
function twoReceivers(o: Point, p: Point): number { return o.x + p.x + o.y + p.y }
function inBranches(o: Point, c: boolean): number { let s = o.x; if (c) s += o.y; else s += o.z; return s + o.w }
function inLoop(o: Point, n: number): number { let s = o.x; for (let i = 0; i < n; i++) s += o.y + o.z; return s }
function aroundCall(o: Point, f: () => void): number { const before = o.x + o.y; f(); return before + o.z + o.w }
function nested(o: Point): number { return o.inner.v + o.inner.w + o.x }
const table = [fourReads, fourStores, twoReceivers, inBranches, inLoop, aroundCall, nested];
(globalThis as { kept?: unknown }).kept = table;

let sum = 0;
for (let i = 0; i < 50; i++) {
  const o = i % 5 === 4 ? elsewhere(i) : make(i), p = i % 7 === 6 ? elsewhere(i + 1) : make(i + 1);
  sum += fourReads(o) + twoReceivers(o, p) + inBranches(o, i % 2 === 0) + inLoop(p, 3) + aroundCall(o, count) + nested(p);
  fourStores(p, i);
  sum += fourReads(p);
}
console.log(sum, calls);
