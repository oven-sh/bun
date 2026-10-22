// Under allocation pressure, fields of nodes in a long list are turned into accessors and nodes get another prototype: every change succeeds, no TypeError is counted, and typed code reads the nodes as they are then.
interface Cell { id: number; weight: number; label: string; next?: Cell }
function churn(n: number): number { let s = 0; for (let i = 0; i < n; i++) { const junk: Cell = { id: i, weight: i + 0.5, label: "junk" + (i & 7) }; s += junk.label.length + junk.id % 3 } return s }
let list: Cell = { id: 0, weight: 0.25, label: "c0" }
for (let i = 1; i < 20000; i++) list = { id: i, weight: i / 4, label: "c" + i, next: list }
const sharedProto = { kindOf() { return "patched" } }
let index = 0, accessors = 0, prototypes = 0, others = 0
for (let c: Cell | undefined = list; c; c = c.next, index++) {
  if (index % 13 === 0) { const kept = { v: c.weight }; try { Object.defineProperty(c, "weight", { get() { return kept.v }, enumerable: true, configurable: true }); others++ } catch (e) { if (e instanceof TypeError) accessors++; else others++ } }
  if (index % 17 === 0) try { Object.setPrototypeOf(c, sharedProto); others++ } catch (e) { if (e instanceof TypeError) prototypes++; else others++ }
  if (index % 1000 === 0) churn(5000)
}
churn(100000)
let n = 0, weights = 0, patched = 0
for (let c: Cell | undefined = list; c; c = c.next) { n++; weights += c.weight; if ("kindOf" in c) patched++ }
console.log("field made an accessor: TypeError", accessors, "another prototype: TypeError", prototypes, "anything else", others)
console.log(n, weights, patched)
